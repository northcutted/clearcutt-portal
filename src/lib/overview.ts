// What the overview answers first: what is outstanding, why images fall
// short (grouped by reason, not one card per image), how old the oldest scan
// is, and the filtered lists the overview's tiles link to. Everything is
// counted from the report; nothing here concludes more than it says.
import type { EstateReport, Image } from './contract.gen.ts';
import { byVerdict, imageLabel, staleImages } from './estate.ts';
import { compareTimes, plural } from './format.ts';
import type { Tone } from './present.ts';

// ── Reasons ─────────────────────────────────────────────────────────────

/**
 * What a verdict reason says about its requirement: `failed`, the check ran
 * and the image fell short of it; `unknown`, it couldn't be decided (evidence
 * that couldn't be read or checked, or that no trusted signer vouched for;
 * vulnerabilities no scan covers, or a rescan that couldn't run; drift from a
 * base the image only claims; a rebuild that couldn't be checked).
 * clearcutt-verify lists both kinds on a failed image, so an image's verdict
 * alone doesn't say which a reason is.
 */
export type ReasonKind = 'failed' | 'unknown';

// The reasons clearcutt-verify gives for a requirement an image failed
// (estateverify.verdictAt): a check that ran and came out against it.
const FAILING_REASONS = [
  /^[A-Za-z]+ failed verification$/,
  /^[A-Za-z]+ is missing$/,
  /^\d+( fixable)? vulnerabilities at [a-z]+ or above( in this run's scan \(.*\))?$/,
  /^base is \d+ days behind its newest version \(limit \d+\)$/,
  /^rebuilding gave a different digest$/,
];

// The reasons it gives for a requirement it couldn't decide.
const UNDECIDED_REASONS = [
  /unknown/,
  /couldn't be (read|checked|measured)/,
  /\bnot verified\b|isn't verified|isn't proven/,
  /\bnot applicable\b/,
  /no trusted signer/,
  /vouched for nothing/,
  /days old \(limit \d+\)/,
];

/**
 * Whether a reason is a failed requirement or one that couldn't be decided.
 * On an unverified image every reason is undecided. On a failed image a
 * reason this portal doesn't recognize is taken as failed: overstating a
 * reason never makes anything read as a pass.
 */
export function reasonKind(reason: string, verdictStatus: string): ReasonKind {
  if (FAILING_REASONS.some((r) => r.test(reason))) return 'failed';
  if (verdictStatus !== 'failed' || UNDECIDED_REASONS.some((r) => r.test(reason))) return 'unknown';
  return 'failed';
}

export interface ReasonGroup {
  /** The reason's kind, then the reason with each number replaced by #, which the group shares. */
  key: string;
  kind: ReasonKind;
  /** The reason as a heading: numbers that differ between images become a range. */
  text: string;
  /** Each image with the reason, and the reason as its verdict says it. */
  images: { image: Image; reason: string }[];
  /** How many of those images failed, and how many are unverified. */
  failed: number;
  unverified: number;
}

/**
 * The reasons images aren't verified, one group per reason, however many
 * images give it: "3 vulnerabilities at critical or above" and "30
 * vulnerabilities at critical or above" are one reason. Failed requirements
 * come first, then those that couldn't be decided (reasonKind); within each,
 * the reasons with the most images first.
 */
export function reasonGroups(report: EstateReport): ReasonGroup[] {
  const groups = new Map<
    string,
    { kind: ReasonKind; parts: string[][]; images: { image: Image; reason: string }[]; failed: Set<string>; unverified: Set<string> }
  >();
  for (const image of byVerdict(report.images)) {
    if (image.verdict.status === 'verified') continue;
    for (const reason of new Set(image.verdict.reasons.length > 0 ? image.verdict.reasons : ['no reason given'])) {
      const kind = reasonKind(reason, image.verdict.status);
      const parts = reason.split(/(\d+)/);
      const key = `${kind}:${parts.map((p, i) => (i % 2 === 1 ? '#' : p)).join('')}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { kind, parts: [], images: [], failed: new Set(), unverified: new Set() }));
      g.parts.push(parts);
      g.images.push({ image, reason });
      (image.verdict.status === 'failed' ? g.failed : g.unverified).add(image.id);
    }
  }
  const kindOrder = (k: ReasonKind) => (k === 'failed' ? 0 : 1);
  return [...groups]
    .map(([key, g]): ReasonGroup => {
      const first = g.parts[0];
      const text = first
        .map((p, i) => {
          if (i % 2 === 0) return p;
          const ns = g.parts.map((parts) => Number(parts[i]));
          const lo = Math.min(...ns);
          const hi = Math.max(...ns);
          return lo === hi ? p : `${lo}–${hi}`;
        })
        .join('');
      return { key, kind: g.kind, text, images: g.images, failed: g.failed.size, unverified: g.unverified.size };
    })
    .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || b.images.length - a.images.length || a.text.localeCompare(b.text));
}

// ── Scan age ────────────────────────────────────────────────────────────

/** The age past which the overview flags a scan when the policy sets no limit. */
export const DEFAULT_SCAN_AGE_DAYS = 7;

/**
 * The days after which a scan is flagged as old: the build's setting when it
 * has one, else the policy's maxScanAgeDays, else DEFAULT_SCAN_AGE_DAYS.
 */
export function scanAgeLimit(report: EstateReport, setting?: number): number {
  if (setting !== undefined && setting > 0) return setting;
  return report.policy.maxScanAgeDays && report.policy.maxScanAgeDays > 0 ? report.policy.maxScanAgeDays : DEFAULT_SCAN_AGE_DAYS;
}

export interface ScanAge {
  image: Image;
  at: string;
  /** Milliseconds from the scan to the report. */
  ms: number;
}

export interface ScanAges {
  /** Scans with a date, oldest first. */
  dated: ScanAge[];
  /** Images with vulnerability data whose scan has no date (or one that doesn't parse): their age is unknown. */
  undated: Image[];
  /** Images with no vulnerability data at all. */
  unscanned: Image[];
}

const ages = new WeakMap<EstateReport, ScanAges>();

/** How old each image's vulnerability scan was when the report was made. */
export function scanAges(report: EstateReport): ScanAges {
  const cached = ages.get(report);
  if (cached) return cached;
  const now = Date.parse(report.metadata.generatedAt);
  const out: ScanAges = { dated: [], undated: [], unscanned: [] };
  for (const image of report.images) {
    const v = image.vulnerabilities;
    if (!v) out.unscanned.push(image);
    else if (!v.scannedAt || Number.isNaN(Date.parse(v.scannedAt)) || Number.isNaN(now)) out.undated.push(image);
    else out.dated.push({ image, at: v.scannedAt, ms: now - Date.parse(v.scannedAt) });
  }
  out.dated.sort((a, b) => compareTimes(a.at, b.at) || imageLabel(a.image).localeCompare(imageLabel(b.image)));
  ages.set(report, out);
  return out;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** An age in words: "40 minutes", "27 hours", "12 days"; under 48 hours in hours. */
export function formatAge(ms: number): string {
  if (ms < HOUR) return plural(Math.max(0, Math.floor(ms / 60_000)), 'minute');
  if (ms < 48 * HOUR) return plural(Math.floor(ms / HOUR), 'hour');
  return plural(Math.floor(ms / DAY), 'day');
}

/** The scans older than `days`, oldest first. */
export function oldScans(report: EstateReport, days: number): ScanAge[] {
  return scanAges(report).dated.filter((s) => s.ms > days * DAY);
}

// ── Lists ───────────────────────────────────────────────────────────────

export interface ImageList {
  /** Its page: lists/<key>/. */
  key: string;
  title: string;
  /** What puts an image on it, as a sentence. */
  lede: string;
  /** What an empty list says. */
  empty: string;
  images: Image[];
}

/** The filtered lists the overview's tiles and outstanding items link to. */
export function imageLists(report: EstateReport, scanDays: number): ImageList[] {
  const all = byVerdict(report.images);
  const where = (f: (i: Image) => boolean) => all.filter(f);
  const old = new Set(oldScans(report, scanDays).map((s) => s.image.id));
  const undated = new Set(scanAges(report).undated.map((i) => i.id));
  const severe = (i: Image) => (i.vulnerabilities ? i.vulnerabilities.counts.critical + i.vulnerabilities.counts.high : 0);
  const stale = staleImages(report);
  return [
    {
      key: 'verified',
      title: 'Verified images',
      lede: 'Images that meet every requirement in the policy.',
      empty: 'No image is verified.',
      images: where((i) => i.verdict.status === 'verified'),
    },
    {
      key: 'failed',
      title: 'Failed images',
      lede: 'Images that violate at least one requirement in the policy.',
      empty: 'No image failed.',
      images: where((i) => i.verdict.status === 'failed'),
    },
    {
      key: 'unverified',
      title: 'Unverified images',
      lede: "Images for which at least one requirement couldn't be decided: not a pass, and not a failure.",
      empty: 'No image is unverified.',
      images: where((i) => i.verdict.status === 'unverified'),
    },
    {
      key: 'stale-base',
      title: 'Images on a stale base',
      lede: 'Images built on an older version of their base than the newest one this run observed, most days behind first.',
      empty: 'No image is on an older version of its base than the newest one this run observed.',
      images: stale,
    },
    {
      key: 'base-proven',
      title: 'Images whose base is proven',
      lede: "Images that start with their base's exact layer digests.",
      empty: 'No image has a base proven by layer digests.',
      images: where((i) => i.base?.strength === 'proof'),
    },
    {
      key: 'base-claimed',
      title: 'Images whose base is a claim',
      lede: "Images whose base rests on something the image's author wrote (a label, an annotation, or build history), not on its layers.",
      empty: 'No image has a base that rests on a claim.',
      images: where((i) => i.base !== undefined && i.base.strength !== 'proof'),
    },
    {
      key: 'base-unresolved',
      title: 'Images whose base is unknown',
      lede: "Images whose base couldn't be determined; each page says why.",
      empty: 'Every image has a base, or is a root.',
      images: where((i) => !i.base && !i.root),
    },
    {
      key: 'critical-high',
      title: 'Images with critical or high findings',
      lede: 'Images whose vulnerability data has critical or high findings, the most first. The findings page lists them by advisory, fixable first.',
      empty: 'No image with vulnerability data has a critical or high finding.',
      images: all.filter((i) => severe(i) > 0).sort((a, b) => severe(b) - severe(a) || imageLabel(a).localeCompare(imageLabel(b))),
    },
    {
      key: 'not-scanned',
      title: 'Images with no vulnerability data',
      lede: 'Images with no vulnerability data: how many vulnerabilities they have is unknown, not zero.',
      empty: 'Every image has vulnerability data.',
      images: where((i) => !i.vulnerabilities),
    },
    {
      key: 'old-scans',
      title: `Scans older than ${plural(scanDays, 'day')}`,
      lede: `Images whose vulnerability scan was more than ${plural(scanDays, 'day')} old when the report was made, oldest first, and scans with no date. Their findings describe that day; what was found since is unknown.`,
      empty: `No scan is older than ${plural(scanDays, 'day')}, and every scan has a date.`,
      images: [
        ...oldScans(report, scanDays).map((s) => s.image),
        ...all.filter((i) => undated.has(i.id) && !old.has(i.id)),
      ],
    },
    {
      key: 'reproduced',
      title: 'Reproduced images',
      lede: 'Images whose rebuild (or repeated rebase) gave the same digest.',
      empty: 'No image was reproduced.',
      images: where((i) => i.reproducibility.status === 'reproduced'),
    },
    {
      key: 'not-reproduced',
      title: 'Images that did not reproduce',
      lede: 'Images whose rebuild gave a different digest.',
      empty: 'No rebuild gave a different digest.',
      images: where((i) => i.reproducibility.status === 'not-reproduced'),
    },
    {
      key: 'not-checked',
      title: 'Images not checked for reproducibility',
      lede: "Images with a recipe or rebase record that nothing rebuilt: whether they reproduce is unknown.",
      empty: 'Every image with a recipe or rebase record was checked.',
      images: where((i) => i.reproducibility.status === 'not-checked'),
    },
  ];
}

/** The path of a list's page. */
export const listPath = (key: string) => `lists/${key}/`;

// ── What is outstanding ─────────────────────────────────────────────────

export interface Outstanding {
  /** What it is, counted: "6 high findings (5 with a fix)". */
  text: string;
  /** Where the page that lists them is, under the site. */
  path: string;
  tone: Tone;
}

/**
 * What still needs attention, whatever the verdicts say: images that fail or
 * are unverified, critical and high findings, stale bases, rebuilds that
 * didn't reproduce, missing or old vulnerability data, unknown bases. A
 * passing policy says nothing about these unless it asks.
 */
export function outstanding(report: EstateReport, scanDays: number): Outstanding[] {
  const { summary } = report;
  const v = summary.vulnerabilities;
  const out: Outstanding[] = [];
  const add = (n: number, text: string, path: string, tone: Tone) => {
    if (n > 0) out.push({ text, path, tone });
  };
  add(summary.verdicts.failed, `${plural(summary.verdicts.failed, 'image fails', 'images fail')} the policy`, listPath('failed'), 'bad');
  add(summary.verdicts.unverified, `${plural(summary.verdicts.unverified, 'image is', 'images are')} unverified`, listPath('unverified'), 'unknown');
  for (const sev of ['critical', 'high'] as const) {
    add(v.counts[sev], `${plural(v.counts[sev], `${sev} finding`)} (${v.fixable[sev]} with a fix)`, 'findings/', sev === 'critical' ? 'bad' : 'warn');
  }
  add(summary.bases.stale, `${plural(summary.bases.stale, 'image', 'images')} on a stale base`, listPath('stale-base'), 'warn');
  const repro = summary.reproducibility;
  add(repro.notReproduced, `${plural(repro.notReproduced, 'image', 'images')} that did not reproduce`, listPath('not-reproduced'), 'bad');
  add(v.notScanned, `${plural(v.notScanned, 'image', 'images')} with no vulnerability data`, listPath('not-scanned'), 'unknown');
  const old = oldScans(report, scanDays).length;
  const undated = scanAges(report).undated.length;
  add(old, `${plural(old, 'scan', 'scans')} older than ${plural(scanDays, 'day')}`, listPath('old-scans'), 'warn');
  add(undated, `${plural(undated, 'scan', 'scans')} with no date`, listPath('old-scans'), 'unknown');
  add(summary.bases.unresolved, `${plural(summary.bases.unresolved, 'image', 'images')} whose base is unknown`, listPath('base-unresolved'), 'unknown');
  add(repro.notChecked, `${plural(repro.notChecked, 'image', 'images')} not checked for reproducibility`, listPath('not-checked'), 'unknown');
  return out;
}
