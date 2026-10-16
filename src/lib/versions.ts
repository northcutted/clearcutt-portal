// Version ordering for the package search: is libxml2 2.13.9-r0 older than
// 2.14? Each ecosystem orders versions its own way, so a version is compared
// by the scheme of its package's type:
//
//   apk      Alpine and Wolfi (apk-tools): 1.2.3a_rc1-r0; _alpha, _beta, _pre,
//            and _rc come before the release, _cvs, _svn, _git, _hg, and _p
//            after it; more components is newer (1.2 < 1.2.0)
//   deb      dpkg: [epoch:]upstream[-revision], ~ before anything, even the end
//   rpm      rpmvercmp: [epoch:]version[-release], ~ before and ^ after the end
//   semver   golang, npm, cargo: v1.2.3-rc.1 < v1.2.3; Go's stdlib go1.27.0 too
//   pep440   pypi: 1.0.dev1 < 1.0a1 < 1.0rc1 < 1.0 < 1.0.post1; 1!0.1 > 2.0
//   generic  everything else, and any version its scheme can't parse: dpkg's
//            rule over the whole string, after a leading "v"
//
// Limits: a version is compared as text, not checked for validity; apk's
// special treatment of leading zeros (1.01) and commit hashes (~abc) and
// PEP 440's local versions (+local) are ignored; Maven, RubyGems, and NuGet
// orderings fall back to generic, so a pre-release written without "~" (1.0-rc1)
// sorts after its release there.
//
// This module runs in the browser too (the package search), so it imports
// nothing.

export type Scheme = 'apk' | 'deb' | 'rpm' | 'semver' | 'pep440' | 'generic';

const SCHEMES: Record<string, Scheme> = {
  apk: 'apk',
  alpine: 'apk',
  wolfi: 'apk',
  deb: 'deb',
  rpm: 'rpm',
  golang: 'semver',
  go: 'semver',
  npm: 'semver',
  cargo: 'semver',
  pypi: 'pep440',
};

/** The ordering for a package type (the report's `type`, a purl type). */
export function schemeOf(type: string): Scheme {
  return SCHEMES[type.toLowerCase()] ?? 'generic';
}

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c: string | undefined) => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));

/** Two runs of digits as numbers, however long. */
function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+/, '');
  const y = b.replace(/^0+/, '');
  if (x.length !== y.length) return sign(x.length - y.length);
  return x < y ? -1 : x > y ? 1 : 0;
}

// ── dpkg ────────────────────────────────────────────────────────────────

function dpkgOrder(c: string | undefined): number {
  if (c === undefined || isDigit(c)) return 0;
  if (isLetter(c)) return c.charCodeAt(0);
  if (c === '~') return -1;
  return c.charCodeAt(0) + 256;
}

/** dpkg's verrevcmp: non-digit runs by character (~ first, then the end, then letters, then the rest), digit runs as numbers. */
export function dpkgCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while ((i < a.length && !isDigit(a[i])) || (j < b.length && !isDigit(b[j]))) {
      const ac = dpkgOrder(a[i]);
      const bc = dpkgOrder(b[j]);
      if (ac !== bc) return sign(ac - bc);
      i++;
      j++;
    }
    let ei = i;
    while (isDigit(a[ei])) ei++;
    let ej = j;
    while (isDigit(b[ej])) ej++;
    const d = compareDigits(a.slice(i, ei), b.slice(j, ej));
    if (d !== 0) return d;
    i = ei;
    j = ej;
  }
  return 0;
}

interface Evr {
  /** null when the version doesn't say. */
  epoch: string | null;
  version: string;
  /** The Debian revision or rpm release; null when there is none. */
  release: string | null;
}

/** [epoch:]version[-release], as dpkg and rpm split it. */
function parseEvr(v: string): Evr {
  let rest = v.trim();
  let epoch: string | null = null;
  const m = /^(\d+):/.exec(rest);
  if (m) {
    epoch = m[1];
    rest = rest.slice(m[0].length);
  }
  const dash = rest.lastIndexOf('-');
  if (dash > 0) return { epoch, version: rest.slice(0, dash), release: rest.slice(dash + 1) };
  return { epoch, version: rest, release: null };
}

/**
 * Compares two epoch-version-release triples. With `partial`, b is a
 * constraint, and only the parts it gives are compared: "<3.0.15" compares
 * the version alone, "<1:3.0.15-2" all three.
 */
function compareEvr(a: Evr, b: Evr, part: (x: string, y: string) => number, partial: boolean): number {
  if (!partial || b.epoch !== null) {
    const e = compareDigits(a.epoch ?? '0', b.epoch ?? '0');
    if (e !== 0) return e;
  }
  const v = part(a.version, b.version);
  if (v !== 0) return v;
  if (partial && b.release === null) return 0;
  return part(a.release ?? '', b.release ?? '');
}

// ── rpm ─────────────────────────────────────────────────────────────────

/** rpmvercmp: alphanumeric segments, numbers newer than letters, ~ before and ^ after the end. */
export function rpmCompare(a: string, b: string): number {
  if (a === b) return 0;
  const sep = (c: string | undefined) => c !== undefined && !isDigit(c) && !isLetter(c) && c !== '~' && c !== '^';
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while (sep(a[i])) i++;
    while (sep(b[j])) j++;
    if (a[i] === '~' || b[j] === '~') {
      if (a[i] !== '~') return 1;
      if (b[j] !== '~') return -1;
      i++;
      j++;
      continue;
    }
    if (a[i] === '^' || b[j] === '^') {
      if (i >= a.length) return -1;
      if (j >= b.length) return 1;
      if (a[i] !== '^') return 1;
      if (b[j] !== '^') return -1;
      i++;
      j++;
      continue;
    }
    if (i >= a.length || j >= b.length) break;
    const numeric = isDigit(a[i]);
    const same = numeric ? isDigit : isLetter;
    let ei = i;
    while (same(a[ei])) ei++;
    let ej = j;
    while (same(b[ej])) ej++;
    const x = a.slice(i, ei);
    const y = b.slice(j, ej);
    i = ei;
    j = ej;
    // Segments of different kinds: a number is newer than letters.
    if (y === '') return numeric ? 1 : -1;
    const d = numeric ? compareDigits(x, y) : x < y ? -1 : x > y ? 1 : 0;
    if (d !== 0) return d;
  }
  if (i >= a.length && j >= b.length) return 0;
  return i >= a.length ? -1 : 1;
}

// ── apk ─────────────────────────────────────────────────────────────────

// apk-tools' token kinds, in its order: when two versions agree up to where
// their token kinds differ, the one whose next token comes later in this
// list is older (1.2 has END where 1.2.3 has DIGIT, so 1.2 is older), except
// that a pre-release suffix is always older.
const ApkToken = { Digit: 1, Letter: 2, Suffix: 3, SuffixNo: 4, Revision: 5, End: 6 } as const;
type ApkToken = (typeof ApkToken)[keyof typeof ApkToken];
const APK_PRE = ['alpha', 'beta', 'pre', 'rc'];
const APK_POST = ['cvs', 'svn', 'git', 'hg', 'p'];
const APK_VERSION =
  /^(\d+(?:\.\d+)*)([a-z]?)((?:_(?:alpha|beta|pre|rc|cvs|svn|git|hg|p)\d*)*)(?:~[0-9a-f]+)?(?:-r(\d+))?$/;

type Tok = [ApkToken, string];

function apkTokens(v: string): Tok[] | null {
  const m = APK_VERSION.exec(v.trim());
  if (!m) return null;
  const out: Tok[] = m[1].split('.').map((d): Tok => [ApkToken.Digit, d]);
  if (m[2]) out.push([ApkToken.Letter, m[2]]);
  for (const s of m[3].match(/_[a-z]+\d*/g) ?? []) {
    const [, word, n] = /^_([a-z]+)(\d*)$/.exec(s)!;
    const pre = APK_PRE.indexOf(word);
    // Pre-release suffixes rank below zero, the others above.
    out.push([ApkToken.Suffix, String(pre >= 0 ? pre - APK_PRE.length : APK_POST.indexOf(word) + 1)]);
    if (n) out.push([ApkToken.SuffixNo, n]);
  }
  if (m[4] !== undefined) out.push([ApkToken.Revision, m[4]]);
  out.push([ApkToken.End, '']);
  return out;
}

function compareApkTokens(a: Tok[], b: Tok[]): number {
  for (let k = 0; ; k++) {
    const [at, av] = a[k];
    const [bt, bv] = b[k];
    if (at === bt) {
      if (at === ApkToken.End) return 0;
      const d =
        at === ApkToken.Letter ? (av < bv ? -1 : av > bv ? 1 : 0) : at === ApkToken.Suffix ? sign(Number(av) - Number(bv)) : compareDigits(av, bv);
      if (d !== 0) return d;
      continue;
    }
    if (at === ApkToken.Suffix && Number(av) < 0) return -1;
    if (bt === ApkToken.Suffix && Number(bv) < 0) return 1;
    return at > bt ? -1 : 1;
  }
}

// ── semver ──────────────────────────────────────────────────────────────

const SEMVER = /^(?:v|go)?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function compareSemver(a: RegExpExecArray, b: RegExpExecArray): number {
  for (const k of [1, 2, 3]) {
    const d = compareDigits(a[k] ?? '0', b[k] ?? '0');
    if (d !== 0) return d;
  }
  const pa = a[4];
  const pb = b[4];
  if (pa === undefined || pb === undefined) return pa === pb ? 0 : pa === undefined ? 1 : -1;
  const xs = pa.split('.');
  const ys = pb.split('.');
  for (let k = 0; k < Math.max(xs.length, ys.length); k++) {
    const x = xs[k];
    const y = ys[k];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    const d = xn && yn ? compareDigits(x, y) : xn ? -1 : yn ? 1 : x < y ? -1 : x > y ? 1 : 0;
    if (d !== 0) return d;
  }
  return 0;
}

// ── PEP 440 ─────────────────────────────────────────────────────────────

const PEP440 =
  /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|c|rc|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d*))?(?:[-_.]?(dev)[-_.]?(\d*))?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i;

const PRE_RANK: Record<string, number> = { a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 };

/** A sort key per PEP 440: epoch, release, then pre, post, and dev, each with "absent" placed where the spec puts it. */
function pep440Key(m: RegExpExecArray): { epoch: string; release: string[]; rest: number[] } {
  const release = m[2].split('.');
  while (release.length > 1 && /^0+$/.test(release[release.length - 1])) release.pop();
  const hasPre = m[3] !== undefined;
  const post = m[5] ?? (m[6] !== undefined ? m[7] || '0' : undefined);
  const hasDev = m[8] !== undefined;
  const n = (s: string | undefined) => Number(s || '0');
  return {
    epoch: m[1] ?? '0',
    release,
    rest: [
      // A dev release of a final version comes before its pre-releases.
      hasPre ? PRE_RANK[m[3].toLowerCase()] : !hasDev || post !== undefined ? Infinity : -Infinity,
      hasPre ? n(m[4]) : 0,
      post === undefined ? -Infinity : n(post),
      hasDev ? n(m[9]) : Infinity,
    ],
  };
}

function comparePep440(a: RegExpExecArray, b: RegExpExecArray): number {
  const x = pep440Key(a);
  const y = pep440Key(b);
  let d = compareDigits(x.epoch, y.epoch);
  for (let k = 0; d === 0 && k < Math.max(x.release.length, y.release.length); k++) {
    d = compareDigits(x.release[k] ?? '0', y.release[k] ?? '0');
  }
  for (let k = 0; d === 0 && k < x.rest.length; k++) d = sign(x.rest[k] - y.rest[k]);
  return d;
}

// ── Entry points ────────────────────────────────────────────────────────

function generic(a: string, b: string): number {
  const strip = (v: string) => v.trim().replace(/^v(?=\d)/, '');
  return dpkgCompare(strip(a), strip(b));
}

function compare(a: string, b: string, scheme: Scheme, partial: boolean): number {
  switch (scheme) {
    case 'deb':
      return compareEvr(parseEvr(a), parseEvr(b), dpkgCompare, partial);
    case 'rpm':
      return compareEvr(parseEvr(a), parseEvr(b), rpmCompare, partial);
    case 'apk': {
      const x = apkTokens(a);
      const y = apkTokens(b);
      if (!x || !y) return generic(a, b);
      // A constraint without a revision (-rN) ignores the package's.
      const bare = partial && !y.some(([t]) => t === ApkToken.Revision);
      return compareApkTokens(bare ? x.filter(([t]) => t !== ApkToken.Revision) : x, y);
    }
    case 'semver': {
      const x = SEMVER.exec(a.trim());
      const y = SEMVER.exec(b.trim());
      return x && y ? compareSemver(x, y) : generic(a, b);
    }
    case 'pep440': {
      const x = PEP440.exec(a.trim());
      const y = PEP440.exec(b.trim());
      return x && y ? comparePep440(x, y) : generic(a, b);
    }
    default:
      return generic(a, b);
  }
}

/** -1, 0, or 1 as version a is older than, the same as, or newer than b. */
export function compareVersions(a: string, b: string, scheme: Scheme): number {
  return compare(a, b, scheme, false);
}

/**
 * Compares a package's version with the version in a constraint. Only the
 * parts the constraint gives are compared: without an epoch, the package's
 * epoch is ignored; without a revision or release (Debian -1, apk -r0, rpm
 * -1.el9), the package's is too. So "<2.14.0" holds for 2.13.9-r5 and not
 * for 2.14.0-r1, and "=2.14.0" holds for 2.14.0-r1.
 */
export function compareToConstraint(version: string, constraint: string, scheme: Scheme): number {
  return compare(version, constraint, scheme, true);
}

export type Operator = '<' | '<=' | '>' | '>=' | '=' | '!=';

export interface Constraint {
  op: Operator;
  version: string;
}

/** Whether a version satisfies one constraint. */
export function satisfies(version: string, c: Constraint, scheme: Scheme): boolean {
  const d = compareToConstraint(version, c.version, scheme);
  switch (c.op) {
    case '<':
      return d < 0;
    case '<=':
      return d <= 0;
    case '>':
      return d > 0;
    case '>=':
      return d >= 0;
    case '=':
      return d === 0;
    case '!=':
      return d !== 0;
  }
}

/**
 * Whether a version is in a range: any of the alternatives, each of whose
 * constraints all hold. No alternatives means any version.
 */
export function inRange(version: string, ranges: Constraint[][], scheme: Scheme): boolean {
  return ranges.length === 0 || ranges.some((all) => all.every((c) => satisfies(version, c, scheme)));
}
