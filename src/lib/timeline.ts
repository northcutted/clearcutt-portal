// Two runs side by side, image by image, from the history's per-image rows
// (clearcutt-verify v0.15 and later): what each image was before and after,
// and how it changed. A row holds an image's digest, verdict, base, rebase,
// and findings counted by severity; from later clearcutt-verify releases, also
// the IDs of its fixable high and critical findings and a digest of its
// package set. Other findings are only counted, and the digest says that the
// package set changed, not how.
import { createHash } from 'node:crypto';
import type { EstateHistory, HistoryEntry, HistoryImage } from './contract.gen.ts';
import { chronological } from './estate.ts';
import { SEVERITIES, type Severity } from './present.ts';

export interface Run {
  /** A name for the run in URLs: its time, as 20261010T165146Z (runSlug). */
  slug: string;
  at: string;
  ref?: string;
  entry: HistoryEntry;
}

/**
 * A run's name in URLs, from the instant it names alone, so it doesn't depend
 * on the other runs: 2026-10-10T18:51:46+02:00 → 20261010T165146Z, and
 * milliseconds when there are any (20261010T165146.5Z → 20261010T165146.500Z),
 * so two runs in the same second keep their own names. A time that doesn't
 * parse is named by a hash of its text: run-1a2b3c4d.
 */
export function runSlug(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return `run-${createHash('sha256').update(at).digest('hex').slice(0, 8)}`;
  return d.toISOString().replace(/\.000Z$/, 'Z').replace(/[-:]/g, '');
}

/**
 * The history's runs, oldest first, each with a slug no other run has. Only
 * runs naming the very same instant share a stem; the later of them gets -2,
 * -3, …, so adding a newer run never renames an older one.
 */
export function historyRuns(history: EstateHistory | null): Run[] {
  const used = new Set<string>();
  return chronological(history).map((entry) => {
    const stem = runSlug(entry.generatedAt);
    let slug = stem;
    for (let n = 2; used.has(slug); n++) slug = `${stem}-${n}`;
    used.add(slug);
    return { slug, at: entry.generatedAt, ...(entry.ref !== undefined ? { ref: entry.ref } : {}), entry };
  });
}

/**
 * How an image changed between two runs:
 *
 *   added       in the newer run only
 *   removed     in the older run only
 *   rebased     a new digest, from a rebase the older run didn't record
 *   rebuilt     a new digest otherwise
 *   base-moved  the same digest, but its base is more or less current than before
 *               (usually: the base's tag moved on to a newer version)
 *   unchanged   the same digest, on a base as current as before
 *
 * An unchanged image can still change verdict (the policy or the evidence
 * changed) or findings (new advisories, a new scan, a VEX statement).
 */
export type How = 'added' | 'removed' | 'rebased' | 'rebuilt' | 'base-moved' | 'unchanged';

export const HOW_ORDER: How[] = ['removed', 'added', 'rebased', 'rebuilt', 'base-moved', 'unchanged'];

export interface ImageDiff {
  id: string;
  how: How;
  before?: HistoryImage;
  after?: HistoryImage;
  /**
   * For a new digest: whether the base digest changed (true), didn't
   * (false), or a run didn't record it (null).
   */
  newBase?: boolean | null;
  /** Set when the verdict changed. */
  verdict?: [string, string];
  /** Set when the base's currency changed; "none" when a run recorded no base. */
  drift?: [string, string];
  /** Each severity's count before and after; null is unknown (no vulnerability data). */
  findings: Record<Severity, [number | null, number | null]>;
  /** The severities whose count changed, or became known or unknown. */
  findingsChanged: Severity[];
  /**
   * The IDs of its fixable high and critical findings in each run; null
   * when that run had no vulnerability data for it, or didn't record IDs.
   */
  fixable: [string[] | null, string[] | null];
  /** Fixable high and critical findings gone in the newer run, and new in it; null unless both runs list them. */
  fixed: string[] | null;
  introduced: string[] | null;
  /** Whether its package set changed; null unless both runs recorded a digest of it. */
  packagesChanged: boolean | null;
}

/**
 * Whether a run's rows go beyond v0.15's: any row lists fixable findings or
 * a package digest. A row of such a run with vulnerability data and no
 * fixableFindings has none; in an older run, which never lists them, it says
 * nothing.
 */
export function recordsIds(entry: HistoryEntry): boolean {
  return entry.images?.some((row) => row.fixableFindings !== undefined || row.packagesDigest !== undefined) ?? false;
}

function fixableOf(row: HistoryImage | undefined, recorded: boolean): string[] | null {
  if (!row || !recorded || !row.vulnerabilities) return null;
  return [...new Set(row.fixableFindings ?? [])].sort();
}

/**
 * One image across two runs. `recorded` says whether each run lists finding
 * IDs (recordsIds); without it, they are taken as not recorded.
 */
export function diffImage(
  id: string,
  before: HistoryImage | undefined,
  after: HistoryImage | undefined,
  recorded: [boolean, boolean] = [false, false],
): ImageDiff {
  const fixable: [string[] | null, string[] | null] = [fixableOf(before, recorded[0]), fixableOf(after, recorded[1])];
  const [x, y] = fixable;
  const both = before !== undefined && after !== undefined;
  const findings = Object.fromEntries(
    SEVERITIES.map((s) => [s, [before?.vulnerabilities?.[s] ?? null, after?.vulnerabilities?.[s] ?? null]]),
  ) as ImageDiff['findings'];
  const out: ImageDiff = {
    id,
    how: 'unchanged',
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    findings,
    findingsChanged: before && after ? SEVERITIES.filter((s) => findings[s][0] !== findings[s][1]) : [],
    fixable,
    fixed: both && x && y ? x.filter((f) => !y.includes(f)) : null,
    introduced: both && x && y ? y.filter((f) => !x.includes(f)) : null,
    packagesChanged:
      both && before.packagesDigest !== undefined && after.packagesDigest !== undefined ? before.packagesDigest !== after.packagesDigest : null,
  };
  if (!before || !after) return { ...out, how: before ? 'removed' : 'added' };
  if (before.verdict !== after.verdict) out.verdict = [before.verdict, after.verdict];
  const driftBefore = before.base?.drift ?? 'none';
  const driftAfter = after.base?.drift ?? 'none';
  if (driftBefore !== driftAfter) out.drift = [driftBefore, driftAfter];
  if (before.digest !== after.digest) {
    // No digest (or an empty one: a claimed base, no version identified) isn't recorded.
    const a = before.base?.digest || undefined;
    const b = after.base?.digest || undefined;
    out.newBase = a === undefined || b === undefined ? null : a !== b;
    out.how = after.rebasedFrom !== undefined && after.rebasedFrom !== before.rebasedFrom ? 'rebased' : 'rebuilt';
  } else if (out.drift) {
    out.how = 'base-moved';
  }
  return out;
}

/**
 * Every image in either run, and how it changed; null when either run
 * recorded no per-image rows (clearcutt-verify before v0.15).
 */
export function diffRuns(older: HistoryEntry, newer: HistoryEntry): ImageDiff[] | null {
  if (!older.images || !newer.images) return null;
  const before = new Map(older.images.map((i) => [i.id, i]));
  const after = new Map(newer.images.map((i) => [i.id, i]));
  const recorded: [boolean, boolean] = [recordsIds(older), recordsIds(newer)];
  const ids = [...new Set([...after.keys(), ...before.keys()])];
  return ids
    .map((id) => diffImage(id, before.get(id), after.get(id), recorded))
    .sort((x, y) => HOW_ORDER.indexOf(x.how) - HOW_ORDER.indexOf(y.how) || x.id.localeCompare(y.id));
}

/** Whether anything about the image changed: its digest, base, verdict, findings, or packages, or it came or went. */
export function changed(diff: ImageDiff): boolean {
  return (
    diff.how !== 'unchanged' ||
    diff.verdict !== undefined ||
    diff.findingsChanged.length > 0 ||
    (diff.fixed?.length ?? 0) > 0 ||
    (diff.introduced?.length ?? 0) > 0 ||
    diff.packagesChanged === true
  );
}

/** How many images changed each way. */
export function countHows(diffs: ImageDiff[]): Record<How, number> {
  const out = Object.fromEntries(HOW_ORDER.map((h) => [h, 0])) as Record<How, number>;
  for (const d of diffs) out[d.how]++;
  return out;
}

/** How an image changed, in words: a label and a sentence. */
export function howWords(diff: ImageDiff): { label: string; meaning: string } {
  switch (diff.how) {
    case 'added':
      return { label: 'New', meaning: 'In the newer run only.' };
    case 'removed':
      return { label: 'Gone', meaning: 'In the older run only.' };
    case 'rebased':
      return {
        label: 'Rebased',
        meaning: `A new digest from a rebase: its layers were moved onto ${diff.newBase === false ? 'the same' : 'a newer'} base without a rebuild.`,
      };
    case 'rebuilt':
      return diff.newBase === true
        ? { label: 'Rebuilt on a new base', meaning: 'A new digest, built on another version of its base.' }
        : diff.newBase === false
          ? { label: 'Rebuilt, same base', meaning: 'A new digest on the same base: its own layers changed.' }
          : { label: 'Rebuilt', meaning: "A new digest. Whether its base changed isn't recorded." };
    case 'base-moved':
      return diff.drift?.[1] === 'stale'
        ? { label: 'Base moved', meaning: 'The same image, but its base has a newer version now.' }
        : { label: 'Base moved', meaning: `The same image; its base went from ${diff.drift?.[0]} to ${diff.drift?.[1]}.` };
    default:
      return { label: 'Unchanged', meaning: 'The same digest, on a base as current as before.' };
  }
}

export interface Drill {
  severity: Severity;
  /** Images with findings of this severity in the older run, and in the newer. */
  before: string[];
  after: string[];
  /** In both runs: had some and now have none, or had none and now have some. */
  cleared: string[];
  appeared: string[];
  /** In both runs, with this count unknown in one of them. */
  unknown: string[];
}

/**
 * Per severity, which images had findings before and which after: the
 * question an advisory raises ("who had criticals, who still does, and
 * what changed about them"), at the level of counts the history keeps.
 */
export function findingsDrill(diffs: ImageDiff[]): Drill[] {
  return SEVERITIES.map((severity) => {
    const d: Drill = { severity, before: [], after: [], cleared: [], appeared: [], unknown: [] };
    for (const diff of diffs) {
      const [x, y] = diff.findings[severity];
      if (x !== null && x > 0) d.before.push(diff.id);
      if (y !== null && y > 0) d.after.push(diff.id);
      if (!diff.before || !diff.after) continue;
      if (x === null || y === null) {
        if (x !== y) d.unknown.push(diff.id);
      } else if (x > 0 && y === 0) d.cleared.push(diff.id);
      else if (x === 0 && y > 0) d.appeared.push(diff.id);
    }
    return d;
  }).filter((d) => d.before.length + d.after.length + d.unknown.length > 0);
}

export interface FindingDrill {
  /** A fixable high or critical finding, e.g. CVE-2026-1234 or GO-2026-6603. */
  id: string;
  /** Images that had it in the older run, and in the newer. */
  before: string[];
  after: string[];
  /** Of the images in both runs: those it is gone from, and those it is new in. */
  fixed: string[];
  introduced: string[];
}

/**
 * Per fixable high or critical finding, which images had it before and
 * after, and where it was fixed or introduced: an advisory's drill, by ID.
 * Null when neither run lists finding IDs.
 */
export function fixableDrill(diffs: ImageDiff[]): FindingDrill[] | null {
  if (!diffs.some((d) => d.fixable[0] !== null || d.fixable[1] !== null)) return null;
  const drills = new Map<string, FindingDrill>();
  const get = (id: string) => {
    let d = drills.get(id);
    if (!d) drills.set(id, (d = { id, before: [], after: [], fixed: [], introduced: [] }));
    return d;
  };
  for (const diff of diffs) {
    for (const f of diff.fixable[0] ?? []) get(f).before.push(diff.id);
    for (const f of diff.fixable[1] ?? []) get(f).after.push(diff.id);
    for (const f of diff.fixed ?? []) get(f).fixed.push(diff.id);
    for (const f of diff.introduced ?? []) get(f).introduced.push(diff.id);
  }
  return [...drills.values()].sort(
    (a, b) => b.introduced.length - a.introduced.length || b.after.length - a.after.length || b.fixed.length - a.fixed.length || a.id.localeCompare(b.id),
  );
}

export interface Comparison {
  older: Run;
  newer: Run;
  /** The comparison's page: history/changes/<slug>/. */
  slug: string;
  /** Whether the page compares with whichever run is the latest (<older>--latest). */
  sinceLatest: boolean;
}

/** What a comparison with the latest run says in its URL instead of that run's time. */
export const LATEST = 'latest';

/**
 * A comparison's name in URLs. Two runs: <older>--<newer>, which always
 * names the same pair. With `LATEST`: <older>--latest, "what changed since
 * that run", which stays the same URL when a newer run arrives.
 */
export const comparisonSlug = (older: Run, newer: Run | typeof LATEST) =>
  `${older.slug}--${newer === LATEST ? LATEST : newer.slug}`;

/**
 * The comparisons the site pre-renders, newest first: each run with the one
 * before it (<older>--<newer>), then each run with the latest
 * (<older>--latest). Every URL stays when a run is added: a pair keeps its
 * page, and "since" a run keeps its URL, now up to the newer latest.
 */
export function comparisons(runs: Run[]): Comparison[] {
  const out: Comparison[] = [];
  for (let i = runs.length - 1; i > 0; i--) {
    out.push({ older: runs[i - 1], newer: runs[i], slug: comparisonSlug(runs[i - 1], runs[i]), sinceLatest: false });
  }
  const latest = runs.at(-1);
  if (latest) {
    for (let i = runs.length - 2; i >= 0; i--) {
      out.push({ older: runs[i], newer: latest, slug: comparisonSlug(runs[i], LATEST), sinceLatest: true });
    }
  }
  return out;
}
