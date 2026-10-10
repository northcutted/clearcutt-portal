// Views derived from one report. Everything here rearranges what the report
// says; nothing adds a conclusion the report doesn't make.
import type { Base, BaseLink, EstateHistory, EstateReport, HistoryEntry, Image, PackageUse } from './contract.gen.ts';
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

export function staleImages(report: EstateReport): (Image & { base: BaseLink })[] {
  return report.images
    .filter((image): image is Image & { base: BaseLink } => image.base?.drift === 'stale')
    .sort((a, b) => b.base.daysBehind - a.base.daysBehind || b.base.versionsBehind - a.base.versionsBehind);
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
 * Images whose package set couldn't be read. A package's absence says
 * nothing about these.
 */
export function packagesUnknown(report: EstateReport): Image[] {
  return report.images.filter((image) => image.packages === undefined);
}

// ── History ─────────────────────────────────────────────────────────────

/** History entries oldest first, for drawing a series left to right. */
export function chronological(history: EstateHistory | null): HistoryEntry[] {
  if (!history) return [];
  return [...history.entries].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}
