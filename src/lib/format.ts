// Small display helpers. None of them invent a value: anything absent comes
// back as undefined so the caller has to decide how to say "unknown".

/** 2026-10-06 23:30 UTC */
export function formatTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** 2026-10-06 */
export function formatDay(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/**
 * Orders RFC 3339 times by the instant they name, not by their text, so an
 * offset (18:00+02:00 is 16:00Z) or a fractional second (46.5Z is after 46Z)
 * sorts where it belongs. A time that doesn't parse sorts before every one
 * that does, by its text; equal instants compare equal, so a stable sort
 * keeps their order.
 */
export function compareTimes(a: string, b: string): number {
  const x = Date.parse(a);
  const y = Date.parse(b);
  const badX = Number.isNaN(x);
  const badY = Number.isNaN(y);
  if (badX || badY) return badX && badY ? (a < b ? -1 : a > b ? 1 : 0) : badX ? -1 : 1;
  return x - y;
}

/** The first and last instants of years 0000 to 9999, in milliseconds. */
const FIRST_MS = -62_167_219_200_000; // 0000-01-01T00:00:00Z (Date.UTC maps year 0 to 1900)
const LAST_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/**
 * The UTC day a Unix time in seconds names (2026-10-06), or undefined when it
 * isn't a day of the years 0000 to 9999, so a huge, negative, or non-finite
 * value never throws (Date's toISOString does, past ±8.64e15 ms) or prints
 * as an extended year.
 */
export function formatEpochDay(seconds: number): string | undefined {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || ms < FIRST_MS || ms > LAST_MS) return undefined;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, or undefined when either is missing. */
export function daysBetween(from: string | undefined, to: string | undefined): number | undefined {
  if (!from || !to) return undefined;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined;
  return Math.floor((b - a) / 86_400_000);
}

/** sha256:0123456789ab */
export function shortDigest(digest: string | undefined): string | undefined {
  if (!digest) return undefined;
  const [algo, hex] = digest.split(':');
  return hex ? `${algo}:${hex.slice(0, 12)}` : digest.slice(0, 19);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The last path segment of a repository: ghcr.io/acme/images/billing → billing. */
export function repoName(repository: string): string {
  return repository.slice(repository.lastIndexOf('/') + 1);
}
