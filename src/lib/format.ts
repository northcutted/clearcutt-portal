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
