// Views derived from one report. Everything here rearranges what the report
// says; nothing adds a conclusion the report doesn't make.
import type {
  Base,
  BaseLink,
  EstateHistory,
  EstateReport,
  HistoryEntry,
  HistoryImage,
  Image,
  PackageUse,
  Stack,
  StackVersion,
} from './contract.gen.ts';
import { repoName, shortDigest } from './format.ts';

/** billing:latest, or billing@sha256:0123… when untagged. */
export function imageLabel(image: Image): string {
  const name = repoName(image.repository);
  return image.tags.length > 0 ? `${name}:${image.tags.join(', ')}` : `${name}@${shortDigest(image.digest)}`;
}

/** ghcr.io/acme/images/billing:latest */
export function imageRef(image: Image): string {
  return image.tags.length > 0 ? `${image.repository}:${image.tags[0]}` : `${image.repository}@${image.digest}`;
}

export function imagesById(report: EstateReport): Map<string, Image> {
  return new Map(report.images.map((image) => [image.id, image]));
}

/** Images whose base is the given image (by the report's own link). */
export function consumersOf(report: EstateReport, image: Image): Image[] {
  return report.images.filter((other) => other.base?.imageId === image.id);
}

const VERDICT_ORDER: Record<string, number> = { failed: 0, unverified: 1, verified: 2 };

/** Failed first, then unverified, then verified; by name within each. */
export function byVerdict(images: Image[]): Image[] {
  return [...images].sort(
    (a, b) =>
      (VERDICT_ORDER[a.verdict.status] ?? -1) - (VERDICT_ORDER[b.verdict.status] ?? -1) ||
      imageLabel(a).localeCompare(imageLabel(b)),
  );
}

/**
 * How many days an image is behind its base's newest version, or null when
 * the base is stale but its age couldn't be measured (a creation time is
 * missing, or zeroed by a reproducible build). clearcutt-verify then sets
 * base.daysBehindUnknown, a field newer than the vendored contract, and
 * daysBehind is 0 and means nothing.
 */
export function daysBehind(base: BaseLink): number | null {
  return (base as BaseLink & { daysBehindUnknown?: unknown }).daysBehindUnknown === true ? null : base.daysBehind;
}

/** Stale images, most days behind first; those whose age is unknown last. */
export function staleImages(report: EstateReport): (Image & { base: BaseLink })[] {
  return report.images
    .filter((image): image is Image & { base: BaseLink } => image.base?.drift === 'stale')
    .sort(
      (a, b) =>
        (daysBehind(b.base) ?? -1) - (daysBehind(a.base) ?? -1) || b.base.versionsBehind - a.base.versionsBehind,
    );
}

// ── The base-image graph ────────────────────────────────────────────────

export interface BaseNode {
  repository: string;
  /** The report's entry for this base repository, when it has one. */
  base?: Base;
  /** Images of this repository that are themselves in the report. */
  images: Image[];
  consumers: ConsumerNode[];
}

export interface ConsumerNode {
  image: Image;
  link: BaseLink;
  /** Set when this consumer's repository is itself a base for others. */
  asBase?: BaseNode;
}

export interface BaseGraph {
  /** Base repositories that aren't built on anything in the report. */
  roots: BaseNode[];
  /** Images with no base and no consumers: roots nothing here is built on. */
  standalone: Image[];
  /** Images whose base couldn't be determined. */
  unresolved: Image[];
}

export function baseGraph(report: EstateReport): BaseGraph {
  const bases = new Map(report.bases.map((b) => [b.repository, b]));
  const repos = new Set<string>(report.bases.map((b) => b.repository));
  for (const image of report.images) if (image.base) repos.add(image.base.repository);

  const imagesOfRepo = (repository: string) => report.images.filter((i) => i.repository === repository);
  const consumersOfRepo = (repository: string) =>
    report.images
      .filter((i): i is Image & { base: BaseLink } => i.base?.repository === repository)
      .sort((a, b) => imageLabel(a).localeCompare(imageLabel(b)));

  const placed = new Set<string>();
  const build = (repository: string, trail: Set<string>): BaseNode => {
    placed.add(repository);
    const next = new Set(trail).add(repository);
    return {
      repository,
      base: bases.get(repository),
      images: imagesOfRepo(repository),
      consumers: consumersOfRepo(repository).map((image) => ({
        image,
        link: image.base,
        asBase:
          repos.has(image.repository) && !next.has(image.repository) && !placed.has(image.repository)
            ? build(image.repository, next)
            : undefined,
      })),
    };
  };

  // A base repository is a root of the graph when none of its own images is
  // built on another base.
  const roots: BaseNode[] = [];
  for (const repository of [...repos].sort()) {
    if (imagesOfRepo(repository).some((i) => i.base)) continue;
    roots.push(build(repository, new Set()));
  }
  // Anything left (only possible with a cycle) still gets shown.
  for (const repository of [...repos].sort()) {
    if (!placed.has(repository)) roots.push(build(repository, new Set()));
  }

  return {
    roots,
    standalone: report.images
      .filter((i) => !i.base && !i.unresolved?.length && !repos.has(i.repository))
      .sort((a, b) => imageLabel(a).localeCompare(imageLabel(b))),
    unresolved: report.images
      .filter((i) => !i.base && (i.unresolved?.length ?? 0) > 0)
      .sort((a, b) => imageLabel(a).localeCompare(imageLabel(b))),
  };
}

// ── Packages ────────────────────────────────────────────────────────────

export interface PackageGroup {
  slug: string;
  type: string;
  name: string;
  versions: { version: string; purl?: string; images: string[] }[];
  /** Every image that ships some version of it. */
  images: string[];
}

export function packageGroups(report: EstateReport): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();
  for (const pkg of report.packages) {
    const key = `${pkg.type}\u0000${pkg.name}`;
    let group = groups.get(key);
    if (!group) {
      group = { slug: '', type: pkg.type, name: pkg.name, versions: [], images: [] };
      groups.set(key, group);
    }
    group.versions.push({ version: pkg.version, purl: pkg.purl, images: [...pkg.images].sort() });
  }
  const sorted = [...groups.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type),
  );
  const used = new Set<string>();
  for (const group of sorted) {
    group.versions.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
    group.images = [...new Set(group.versions.flatMap((v) => v.images))].sort();
    const stem = `${group.type}-${group.name}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    let slug = stem || 'package';
    for (let n = 2; used.has(slug); n++) slug = `${stem}-${n}`;
    used.add(slug);
    group.slug = slug;
  }
  return sorted;
}

/** The package versions the report says an image ships. */
export function packagesOf(report: EstateReport, image: Image): PackageUse[] {
  return report.packages
    .filter((pkg) => pkg.images.includes(image.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * Images with no package set in the report. A package's absence says
 * nothing about these.
 */
export function packagesUnknown(report: EstateReport): Image[] {
  return report.images.filter((image) => image.packages === undefined);
}

/**
 * Images whose package list was read from SBOM evidence that isn't
 * verified: some platform image's SBOM had no trusted signer, so its packages
 * are a claim, or left out by a clearcutt-verify that reads only verified
 * SBOMs. Either way a package's absence isn't proof.
 */
export function packagesPartial(report: EstateReport): Image[] {
  return report.images.filter(
    (image) => image.packages !== undefined && image.packagesSource !== undefined && image.packagesSource.status !== 'verified',
  );
}

// ── History ─────────────────────────────────────────────────────────────

/** History entries oldest first, for drawing a series left to right. */
export function chronological(history: EstateHistory | null): HistoryEntry[] {
  if (!history) return [];
  return [...history.entries].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

/** One run of the history, as one image saw it. */
export interface ImageRun {
  at: string;
  /** Where that run's report is stored. */
  ref?: string;
  /**
   * The image's row in that run. null: the run recorded a row per image,
   * and this image wasn't among them. undefined: the run recorded no
   * per-image rows (clearcutt-verify before v0.15), so it can't say.
   */
  row: HistoryImage | null | undefined;
}

/** An image's runs, newest first. */
export function imageRuns(history: EstateHistory | null, id: string): ImageRun[] {
  return chronological(history)
    .reverse()
    .map((entry) => ({
      at: entry.generatedAt,
      ref: entry.ref,
      row: entry.images === undefined ? undefined : (entry.images.find((i) => i.id === id) ?? null),
    }));
}

export interface Rebase {
  /** The first run that recorded it. */
  at: string;
  /** The image whose layers were rebased (repository@digest). */
  from: string;
  /** The digest the rebase produced. */
  digest: string;
  /** Its rebase record's status in that run. */
  status?: string;
}

/** The rebases an image's history records, newest first: one per new rebasedFrom. */
export function rebasesOf(runs: ImageRun[]): Rebase[] {
  const out: Rebase[] = [];
  let last: string | undefined;
  for (const run of [...runs].reverse()) {
    const row = run.row;
    if (!row?.rebasedFrom || row.rebasedFrom === last) continue;
    last = row.rebasedFrom;
    out.push({ at: run.at, from: row.rebasedFrom, digest: row.digest, status: row.rebaseStatus });
  }
  return out.reverse();
}

export interface ImageChange {
  id: string;
  /** added: in the newer run only; removed: in the older run only. */
  kind: 'added' | 'removed' | 'changed';
  verdict?: [string, string];
  digest?: [string, string];
  /** Set when the new digest came from a rebase the older run didn't record. */
  rebasedFrom?: string;
  drift?: [string, string];
  critical?: [number | null, number | null];
  high?: [number | null, number | null];
}

/**
 * What changed for each image between two runs, from their per-image rows;
 * null when either run recorded none.
 */
export function imageChanges(newer: HistoryEntry, older: HistoryEntry): ImageChange[] | null {
  if (!newer.images || !older.images) return null;
  const before = new Map(older.images.map((i) => [i.id, i]));
  const after = new Map(newer.images.map((i) => [i.id, i]));
  const out: ImageChange[] = [];
  for (const [id, b] of after) {
    const a = before.get(id);
    if (!a) {
      out.push({ id, kind: 'added' });
      continue;
    }
    const change: ImageChange = { id, kind: 'changed' };
    if (a.verdict !== b.verdict) change.verdict = [a.verdict, b.verdict];
    if (a.digest !== b.digest) {
      change.digest = [a.digest, b.digest];
      if (b.rebasedFrom && b.rebasedFrom !== a.rebasedFrom) change.rebasedFrom = b.rebasedFrom;
    }
    const driftA = a.base?.drift ?? 'none';
    const driftB = b.base?.drift ?? 'none';
    if (driftA !== driftB) change.drift = [driftA, driftB];
    for (const sev of ['critical', 'high'] as const) {
      const x = a.vulnerabilities?.[sev] ?? null;
      const y = b.vulnerabilities?.[sev] ?? null;
      if (x !== y) change[sev] = [x, y];
    }
    if (Object.keys(change).length > 2) out.push(change);
  }
  for (const id of before.keys()) if (!after.has(id)) out.push({ id, kind: 'removed' });
  const order = { removed: 0, added: 1, changed: 2 };
  return out.sort((x, y) => order[x.kind] - order[y.kind] || x.id.localeCompare(y.id));
}

// ── Stacks ──────────────────────────────────────────────────────────────

/** The registry stack an app is pinned to, and its version, when the report lists them. */
export function stackOf(report: EstateReport, image: Image): { stack: Stack; version: StackVersion } | undefined {
  for (const stack of report.stacks ?? []) {
    const version = stack.versions.find((v) => v.images.includes(image.id));
    if (version) return { stack, version };
  }
  return undefined;
}

/** The fragment a stack's section has on the stacks page. */
export function stackAnchor(stack: Stack): string {
  return `stack-${stack.repository.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/** clearcutt-factory apps and the stack each was built on, by its name. */
export function stackApps(report: EstateReport): Image[] {
  return report.images
    .filter((image) => image.factory?.stack || image.factory?.stackRef)
    .sort((a, b) => imageLabel(a).localeCompare(imageLabel(b)));
}
