// Vulnerability findings across the estate, one entry per advisory ID: which
// images have it, in which package and version, and whether a fix is known.
// Everything here regroups the report's own findings; the only thing added is
// a link to the advisory's canonical page, built from IDs of known shapes.
import type { EstateReport, Finding, Image } from './contract.gen.ts';
import { imageLabel } from './estate.ts';
import { SEVERITIES, type Severity } from './present.ts';

/** One image's finding of an advisory. */
export interface Occurrence {
  image: Image;
  finding: Finding;
}

export interface FindingGroup {
  /** The advisory ID, e.g. CVE-2026-1234 or GHSA-6j4f-fj2g-mc7p. */
  id: string;
  /** Its page: findings/<slug>/. */
  slug: string;
  /** The worst severity any image reports for it (counted findings first). */
  severity: Severity | string;
  /** Whether some image that counts it has a fixed version. */
  fixable: boolean;
  /** The images that count it, by label. */
  counted: Occurrence[];
  /** The images where a VEX statement covers it (not counted). */
  suppressed: Occurrence[];
  /** Each package and version it is found in, "name version", sorted. */
  packages: string[];
}

const rank = (s: string) => {
  const i = (SEVERITIES as readonly string[]).indexOf(s);
  return i < 0 ? SEVERITIES.length : i;
};

/** Whether a finding has a fixed version. */
export const hasFix = (f: Finding) => (f.fixedIn?.length ?? 0) > 0;

/** Critical or high: the severities "fix first" is about. */
export const isSevere = (s: string) => s === 'critical' || s === 'high';

/**
 * Where a finding stands in "what to fix first", lowest first: fixable
 * critical, fixable high, then critical and high with no fix known, then the
 * rest by severity, fixable before not.
 */
export function fixFirstTier(severity: string, fixable: boolean): number {
  if (isSevere(severity)) return (fixable ? 0 : 2) + (severity === 'critical' ? 0 : 1);
  return 4 + rank(severity) * 2 + (fixable ? 0 : 1);
}

/** Orders one image's findings: fix first, then by ID and package. */
export function byFixFirst(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      fixFirstTier(a.severity, hasFix(a)) - fixFirstTier(b.severity, hasFix(b)) ||
      a.id.localeCompare(b.id) ||
      a.package.localeCompare(b.package),
  );
}

/** A page name for each ID: lowercase, safe in a path, and unique. */
function slugs(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const id of [...ids].sort()) {
    const stem = id.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100) || 'finding';
    let slug = stem;
    for (let n = 2; used.has(slug); n++) slug = `${stem}-${n}`;
    used.add(slug);
    out.set(id, slug);
  }
  return out;
}

const cache = new WeakMap<EstateReport, FindingGroup[]>();

/**
 * Every advisory the report's images have, fix first (fixFirstTier), then
 * the most images first, then by ID. Advisories every image's VEX covers
 * come last.
 */
export function findingGroups(report: EstateReport): FindingGroup[] {
  const cached = cache.get(report);
  if (cached) return cached;
  const byId = new Map<string, { counted: Occurrence[]; suppressed: Occurrence[]; packages: Set<string> }>();
  for (const image of report.images) {
    for (const finding of image.vulnerabilities?.findings ?? []) {
      let g = byId.get(finding.id);
      if (!g) byId.set(finding.id, (g = { counted: [], suppressed: [], packages: new Set() }));
      (finding.suppressed ? g.suppressed : g.counted).push({ image, finding });
      g.packages.add(`${finding.package} ${finding.version}`);
    }
  }
  const names = slugs([...byId.keys()]);
  const byLabel = (a: Occurrence, b: Occurrence) =>
    imageLabel(a.image).localeCompare(imageLabel(b.image)) || a.finding.package.localeCompare(b.finding.package);
  const groups = [...byId].map(([id, g]): FindingGroup => {
    const rated = g.counted.length > 0 ? g.counted : g.suppressed;
    const severity = rated.map((o) => o.finding.severity).sort((a, b) => rank(a) - rank(b))[0];
    return {
      id,
      slug: names.get(id)!,
      severity,
      fixable: g.counted.some((o) => hasFix(o.finding)),
      counted: g.counted.sort(byLabel),
      suppressed: g.suppressed.sort(byLabel),
      packages: [...g.packages].sort(),
    };
  });
  const tier = (g: FindingGroup) => (g.counted.length === 0 ? 1000 : fixFirstTier(g.severity, g.fixable));
  groups.sort(
    (a, b) =>
      tier(a) - tier(b) ||
      new Set(b.counted.map((o) => o.image.id)).size - new Set(a.counted.map((o) => o.image.id)).size ||
      a.id.localeCompare(b.id),
  );
  cache.set(report, groups);
  return groups;
}

/** The images that count a finding, each once. */
export function affectedImages(group: FindingGroup): Image[] {
  return [...new Map(group.counted.map((o) => [o.image.id, o.image])).values()];
}

const pages = new WeakMap<EstateReport, Map<string, string>>();

/** The page of the finding with this ID, as a path under the site; undefined when no image has it. */
export function findingPath(report: EstateReport, id: string): string | undefined {
  let map = pages.get(report);
  if (!map) pages.set(report, (map = new Map(findingGroups(report).map((g) => [g.id, `findings/${encodeURIComponent(g.slug)}/`]))));
  return map.get(id);
}

/** A link to an advisory's canonical page. */
export interface AdvisoryLink {
  label: string;
  url: string;
}

// IDs are report data, written by a scanner the report trusts only as far as
// its signature goes, so a link is built only from an ID of a known shape,
// and that ID alone: nothing else of it reaches the URL.
const ADVISORIES: { pattern: RegExp; links: (id: string) => AdvisoryLink[] }[] = [
  {
    pattern: /^CVE-\d{4}-\d{4,7}$/,
    links: (id) => [
      { label: 'CVE record', url: `https://www.cve.org/CVERecord?id=${id}` },
      { label: 'NVD', url: `https://nvd.nist.gov/vuln/detail/${id}` },
    ],
  },
  {
    pattern: /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/,
    links: (id) => [{ label: 'GitHub advisory', url: `https://github.com/advisories/${id}` }],
  },
  {
    pattern: /^GO-\d{4}-\d{4,7}$/,
    links: (id) => [{ label: 'Go vulnerability database', url: `https://pkg.go.dev/vuln/${id}` }],
  },
  {
    pattern: /^PYSEC-\d{4}-\d{1,7}$/,
    links: (id) => [{ label: 'OSV', url: `https://osv.dev/vulnerability/${id}` }],
  },
  {
    pattern: /^RUSTSEC-\d{4}-\d{4}$/,
    links: (id) => [{ label: 'RustSec', url: `https://rustsec.org/advisories/${id}.html` }],
  },
];

/** The advisory's canonical pages, or none when the ID isn't of a shape this site knows. */
export function advisoryLinks(id: string): AdvisoryLink[] {
  return ADVISORIES.find((a) => a.pattern.test(id))?.links(id) ?? [];
}
