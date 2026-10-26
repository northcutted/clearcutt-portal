// The package search: "who ships libxml2 <2.14", including the images that
// only have it because their base does.
//
// The build writes an index (buildSearchIndex) to packages/search-index.json;
// a script of the site fetches it and runs search() in the browser, and the
// per-package pages use the same functions to list, without script, the
// images that inherit each version. Everything here only rearranges what the
// report says: an image "inherits" a package when the report links it to a
// base whose package list has it, and how that link is known travels with
// the answer.
//
// Query syntax (QUERY_HELP says the same for people):
//
//   query       = [type ":"] name [ranges]
//   name        = a package name, any case; * matches any run of characters
//   type        = a package type in the report (apk, deb, rpm, golang, …)
//   ranges      = range { "||" range }        any of these
//   range       = constraint { [","] constraint }   all of these
//   constraint  = [op] version                 no op means =
//   op          = "<" | "<=" | ">" | ">=" | "=" | "==" | "!="
//
//   libxml2 <2.14            openssl >=3.0,<3.0.15
//   deb:openssl <3.0.15      openssl <1.1.1w || >=3.0,<3.0.15
//   libxml2*                 (every version of every package named libxml2…)
import type { EstateReport, Image } from './contract.gen.ts';
import { imageLabel, packageGroups } from './estate.ts';
import { inRange, schemeOf, type Constraint, type Operator, type Scheme } from './versions.ts';

// ── Queries ─────────────────────────────────────────────────────────────

export interface PackageQuery {
  /** Only packages of this type, when the query names one. */
  type?: string;
  /** The name as typed; * is a wildcard. */
  name: string;
  /** Any of these alternatives, each a list of constraints that must all hold; empty means any version. */
  ranges: Constraint[][];
}

export type Parsed = { ok: true; query: PackageQuery } | { ok: false; error: string };

export const QUERY_EXAMPLES = ['libxml2 <2.14', 'openssl >=3.0,<3.0.15', 'deb:openssl <3.0.15', 'openssl <1.1.1w || >=3.0,<3.0.15'];

const OPERATORS: Record<string, Operator> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=', '=': '=', '==': '=', '!=': '!=' };
// One constraint: an optional operator, then a version, which runs to the
// next space, comma, operator character, or "|".
const CONSTRAINT = /(<=|>=|==|!=|<|>|=)?\s*([^\s,<>=|]*)/y;

/**
 * Reads a query. `types` are the package types in the index: "deb:openssl"
 * filters by type only when deb is one of them, since a name may itself
 * contain a colon (Maven's group:artifact).
 */
export function parseQuery(text: string, types: Iterable<string> = []): Parsed {
  const input = text.trim();
  if (input === '') return { ok: false, error: 'Type a package name, e.g. libxml2 <2.14.' };
  const nameEnd = input.search(/[\s<>=!]/);
  let name = nameEnd < 0 ? input : input.slice(0, nameEnd);
  const rest = nameEnd < 0 ? '' : input.slice(nameEnd);
  if (name === '') return { ok: false, error: 'Start with a package name, then the versions: libxml2 <2.14.' };
  let type: string | undefined;
  const colon = name.indexOf(':');
  if (colon > 0) {
    const prefix = name.slice(0, colon).toLowerCase();
    if (new Set([...types].map((t) => t.toLowerCase())).has(prefix)) {
      type = prefix;
      name = name.slice(colon + 1);
      if (name === '') return { ok: false, error: `Name a package after "${prefix}:".` };
    }
  }

  const ranges: Constraint[][] = [];
  if (rest.trim() !== '') {
    for (const alternative of rest.split('||')) {
      const all: Constraint[] = [];
      let i = 0;
      while (i < alternative.length) {
        if (/[\s,]/.test(alternative[i])) {
          i++;
          continue;
        }
        CONSTRAINT.lastIndex = i;
        const m = CONSTRAINT.exec(alternative)!;
        const [whole, op, version] = m;
        if (whole === '' || version === '') {
          const at = alternative.slice(i).trim();
          return { ok: false, error: op ? `"${op}" needs a version after it.` : `Can't read "${at}": use <, <=, >, >=, =, or != and a version.` };
        }
        if (/^[~^]/.test(version)) {
          return { ok: false, error: `"${version}": ~ and ^ ranges aren't supported; write the bounds, e.g. >=1.2,<2.` };
        }
        if (version.includes('*')) return { ok: false, error: `"${version}": * works only in a name; write the bounds, e.g. >=2,<3.` };
        all.push({ op: OPERATORS[op ?? '='], version });
        i = CONSTRAINT.lastIndex;
      }
      if (all.length === 0) return { ok: false, error: 'Each side of "||" needs a version, e.g. <1.1.1w || >=3.0,<3.0.15.' };
      ranges.push(all);
    }
  }
  return { ok: true, query: { type, name, ranges } };
}

/** Whether a package name matches the query's name: any case, * as a wildcard. */
export function nameMatcher(name: string): (candidate: string) => boolean {
  const pattern = new RegExp(`^${name.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  return (candidate) => pattern.test(candidate);
}

// ── The index ───────────────────────────────────────────────────────────

/** Whether an image's package list is in the report, and whether it rests on verified SBOMs. */
export type PackageList = 'known' | 'partial' | 'unknown';

export interface IndexImage {
  id: string;
  label: string;
  href: string;
  packages: PackageList;
  /** The base the report links it to, when that base is in the report. */
  base?: {
    id: string;
    /** How the link is known: proof, declared, assisted, or weak. */
    strength: string;
    /**
     * Whether the image is built on the very version of the base whose
     * packages the report read: false for an image on an older version (the
     * base's list describes a newer one), null when the report doesn't say.
     */
    exact: boolean | null;
  };
}

export interface IndexPackage {
  name: string;
  type: string;
  href: string;
  versions: { version: string; images: string[] }[];
}

export interface SearchIndex {
  images: IndexImage[];
  packages: IndexPackage[];
}

export function packageList(image: Image): PackageList {
  if (image.packages === undefined) return 'unknown';
  return image.packagesSource && image.packagesSource.status !== 'verified' ? 'partial' : 'known';
}

/** Whether an image is built on exactly the version of its base that the report describes. */
function onExactBase(image: Image, base: Image | undefined): boolean | null {
  const digest = image.base?.digest;
  if (!base || !digest) return null;
  return digest === base.digest || base.platforms.some((p) => p.digest === digest);
}

export function buildSearchIndex(
  report: EstateReport,
  links: { image: (id: string) => string; package: (slug: string) => string },
): SearchIndex {
  const byId = new Map(report.images.map((i) => [i.id, i]));
  const images = [...report.images]
    .sort((a, b) => imageLabel(a).localeCompare(imageLabel(b)))
    .map((image): IndexImage => {
      const baseImage = image.base?.imageId ? byId.get(image.base.imageId) : undefined;
      return {
        id: image.id,
        label: imageLabel(image),
        href: links.image(image.id),
        packages: packageList(image),
        ...(image.base && baseImage
          ? { base: { id: baseImage.id, strength: image.base.strength, exact: onExactBase(image, baseImage) } }
          : {}),
      };
    });
  const packages = packageGroups(report).map((g) => ({
    name: g.name,
    type: g.type,
    href: links.package(g.slug),
    versions: g.versions.map((v) => ({ version: v.version, images: v.images })),
  }));
  return { images, packages };
}

// ── Answers ─────────────────────────────────────────────────────────────

export interface Direct {
  id: string;
  /** The matching versions it ships. */
  versions: string[];
  /** Its base, when the base ships a matching version too (or inherits one). */
  baseToo?: string;
}

export interface Inherited {
  id: string;
  /** The nearest image down the chain of bases that ships a matching version itself. */
  from: string;
  /** The matching versions `from` ships. */
  versions: string[];
  /** The bases between this image and `from`, nearest first, ending with `from`. */
  via: string[];
  /** The weakest link in that chain: proof, declared, assisted, or weak. */
  strength: string;
  /** Every link built on exactly the version the report read (true), one not (false), or unknown (null). */
  exact: boolean | null;
  /**
   * What this image's own package list says: unknown (it has none), another
   * version (it lists the package at versions that don't match), or not
   * listed (its list doesn't have the package).
   */
  own: 'unknown' | 'other-version' | 'not-listed';
  /** The versions its own list has, for other-version. */
  ownVersions: string[];
  /** Whether its own list rests on SBOMs no trusted signer verified. */
  ownPartial: boolean;
}

export interface PackageAnswer {
  name: string;
  type: string;
  href: string;
  scheme: Scheme;
  /** How many versions of it the report lists in all. */
  total: number;
  /** The versions that match, oldest first, and who ships each. */
  matching: { version: string; images: string[] }[];
  direct: Direct[];
  inherited: Inherited[];
}

export interface SearchResult {
  answers: PackageAnswer[];
  /** Packages that matched but weren't answered, past the limit. */
  more: number;
  /** Images with no package list in the report: whether they ship it is unknown. */
  unknown: string[];
}

const graphs = new WeakMap<SearchIndex, { images: Map<string, IndexImage>; consumers: Map<string, IndexImage[]> }>();

/** The index's images by ID, and the images built on each, computed once per index. */
function graphOf(index: SearchIndex) {
  let graph = graphs.get(index);
  if (!graph) {
    const consumers = new Map<string, IndexImage[]>();
    for (const image of index.images) {
      if (!image.base) continue;
      const list = consumers.get(image.base.id) ?? [];
      list.push(image);
      consumers.set(image.base.id, list);
    }
    graph = { images: new Map(index.images.map((i) => [i.id, i])), consumers };
    graphs.set(index, graph);
  }
  return graph;
}

const STRENGTH_ORDER = ['proof', 'declared', 'assisted', 'weak'];
const weaker = (a: string, b: string) => {
  const rank = (s: string) => (STRENGTH_ORDER.includes(s) ? STRENGTH_ORDER.indexOf(s) : STRENGTH_ORDER.length);
  return rank(a) >= rank(b) ? a : b;
};
const both = (a: boolean | null, b: boolean | null) => (a === false || b === false ? false : a === null || b === null ? null : true);

/**
 * Who ships a package at the given versions, and who inherits it: every
 * image built, through the report's base links, on one that ships it,
 * nearest source first. Inheritance continues through an image whose own
 * package list is unknown, and stops at one whose list says otherwise.
 */
export function answerFor(index: SearchIndex, pkg: IndexPackage, matching: Set<string>): PackageAnswer {
  const { images, consumers } = graphOf(index);
  const shipped = new Map<string, string[]>();
  const listed = new Map<string, string[]>();
  for (const v of pkg.versions) {
    for (const id of v.images) {
      const into = matching.has(v.version) ? shipped : listed;
      into.set(id, [...(into.get(id) ?? []), v.version]);
    }
  }

  const inherited = new Map<string, Inherited>();
  // Breadth first from every image that ships it, so each inheritor records
  // its nearest source.
  type Step = { image: IndexImage; from: string; via: string[]; strength: string; exact: boolean | null };
  let frontier: Step[] = [...shipped.keys()].sort().flatMap((id) =>
    (consumers.get(id) ?? []).map((image) => ({ image, from: id, via: [id], strength: image.base!.strength, exact: image.base!.exact })),
  );
  while (frontier.length > 0) {
    const next: Step[] = [];
    for (const step of frontier) {
      const { image } = step;
      if (shipped.has(image.id) || inherited.has(image.id)) continue;
      const own = image.packages === 'unknown' ? 'unknown' : listed.has(image.id) ? 'other-version' : 'not-listed';
      inherited.set(image.id, {
        id: image.id,
        from: step.from,
        versions: shipped.get(step.from)!,
        via: step.via,
        strength: step.strength,
        exact: step.exact,
        own,
        ownVersions: listed.get(image.id) ?? [],
        ownPartial: image.packages === 'partial',
      });
      if (own !== 'unknown') continue;
      for (const consumer of consumers.get(image.id) ?? []) {
        next.push({
          image: consumer,
          from: step.from,
          via: [image.id, ...step.via],
          strength: weaker(step.strength, consumer.base!.strength),
          exact: both(step.exact, consumer.base!.exact),
        });
      }
    }
    frontier = next;
  }

  const byLabel = (a: { id: string }, b: { id: string }) => (images.get(a.id)?.label ?? a.id).localeCompare(images.get(b.id)?.label ?? b.id);
  const direct = [...shipped.entries()].map(([id, versions]): Direct => {
    const baseId = images.get(id)?.base?.id;
    const baseToo = baseId !== undefined && (shipped.has(baseId) || inherited.get(baseId)?.own === 'unknown') ? baseId : undefined;
    return { id, versions, ...(baseToo ? { baseToo } : {}) };
  });
  return {
    name: pkg.name,
    type: pkg.type,
    href: pkg.href,
    scheme: schemeOf(pkg.type),
    total: pkg.versions.length,
    matching: pkg.versions.filter((v) => matching.has(v.version)),
    direct: direct.sort(byLabel),
    inherited: [...inherited.values()].sort(byLabel),
  };
}

/** Answers a query: the packages it names, the versions in its range, who ships them, and who inherits them. */
export function search(index: SearchIndex, query: PackageQuery, limit = 25): SearchResult {
  const matchesName = nameMatcher(query.name);
  const answers: PackageAnswer[] = [];
  let more = 0;
  for (const pkg of index.packages) {
    if (query.type !== undefined && pkg.type.toLowerCase() !== query.type) continue;
    if (!matchesName(pkg.name)) continue;
    const scheme = schemeOf(pkg.type);
    const matching = new Set(pkg.versions.filter((v) => inRange(v.version, query.ranges, scheme)).map((v) => v.version));
    if (matching.size === 0) continue;
    if (answers.length >= limit) {
      more++;
      continue;
    }
    answers.push(answerFor(index, pkg, matching));
  }
  return { answers, more, unknown: index.images.filter((i) => i.packages === 'unknown').map((i) => i.id) };
}

/** Every package type in the index, for parseQuery. */
export function indexTypes(index: SearchIndex): string[] {
  return [...new Set(index.packages.map((p) => p.type))].sort();
}

/** Says a constraint list back in words, for headings: "<2.14 or >=3.0, <3.0.15". */
export function describeRanges(ranges: Constraint[][]): string {
  return ranges.map((all) => all.map((c) => `${c.op === '=' ? '=' : c.op}${c.version}`).join(', ')).join(' or ');
}

const STRENGTH_WORDS: Record<string, string> = {
  proof: 'proven by layer digests',
  declared: "declared by the image's author",
  assisted: "partly declared by the image's author",
  weak: "hinted at by the image's build history",
};

/** How an inherited link is known, in words. */
export function strengthWords(strength: string): string {
  return STRENGTH_WORDS[strength] ?? `known by "${strength}"`;
}

/**
 * How an image comes to have a package it inherits, in words: a short label
 * and the details that qualify it (how the base link is known, whether the
 * base's list describes the version it is built on, and what its own list
 * says).
 */
export function inheritedWords(entry: Inherited, label: (id: string) => string): { label: string; detail: string } {
  const through = entry.via.slice(0, -1);
  const parts = [
    `Built on ${through.length > 0 ? `${through.map(label).join(', built on ')}, built on ` : ''}${label(entry.from)}, which ships it.`,
    entry.strength === 'proof'
      ? `The base ${entry.via.length > 1 ? 'links are' : 'link is'} proven by layer digests.`
      : `The weakest base link is ${strengthWords(entry.strength)}: a claim, not proof.`,
  ];
  if (entry.exact === false) {
    parts.push(
      entry.via.length > 1
        ? "Along the way an image is built on an older version of its base than the one whose packages the report read, so it may have another version."
        : "It is built on an older version of that base than the one whose packages the report read, so it may have another version.",
    );
  } else if (entry.exact === null) {
    parts.push("Which version of its base it is built on isn't recorded.");
  }
  const partial = entry.ownPartial ? ', which rests on SBOMs no trusted signer verified' : '';
  if (entry.own === 'unknown') {
    parts.push('Its own package list is not in the report.');
    return { label: 'Inherits it', detail: parts.join(' ') };
  }
  if (entry.own === 'other-version') {
    parts.push(`Its own package list${partial} has ${entry.ownVersions.join(', ')} instead.`);
    return { label: 'Its base ships it', detail: parts.join(' ') };
  }
  parts.push(`Its own package list${partial} doesn't have it: a later layer may have removed it, or the list missed it.`);
  return { label: 'Its base ships it', detail: parts.join(' ') };
}
