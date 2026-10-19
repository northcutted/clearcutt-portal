// Geometry for the history charts, drawn as SVG when the site is built. A
// value of null is unknown: it leaves a gap in a line, never a zero.
import { compareTimes } from './format.ts';

export interface Point {
  /** RFC 3339 time of the run. */
  at: string;
  value: number | null;
}

/** The smallest clean number (1, 2, 5 × 10ⁿ) at or above n; at least 1. */
export function niceMax(n: number): number {
  if (n <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 5, 10]) {
    if (step * pow >= n) return step * pow;
  }
  return 10 * pow;
}

/** Maps run times onto [x0, x1]; a single time (or none) maps to the middle. */
export function timeScale(times: string[], x0: number, x1: number): (at: string) => number {
  const ms = times.map((t) => new Date(t).getTime());
  const lo = Math.min(...ms);
  const hi = Math.max(...ms);
  if (!(hi > lo)) return () => (x0 + x1) / 2;
  return (at) => x0 + ((new Date(at).getTime() - lo) / (hi - lo)) * (x1 - x0);
}

export interface LineGeometry {
  /** One SVG path per unbroken run of known values. */
  paths: string[];
  dots: { x: number; y: number; at: string; value: number }[];
  /** Times with no value, for marking gaps. */
  gaps: { x: number; at: string }[];
  yMax: number;
}

export function lineGeometry(
  points: Point[],
  box: { x0: number; x1: number; y0: number; y1: number },
): LineGeometry {
  const sorted = [...points].sort((a, b) => compareTimes(a.at, b.at));
  const x = timeScale(sorted.map((p) => p.at), box.x0, box.x1);
  const known = sorted.filter((p): p is Point & { value: number } => p.value !== null);
  // Headroom above the largest value, so a line at the maximum doesn't sit on
  // the top rule.
  const yMax = niceMax(Math.max(0, ...known.map((p) => p.value)) * 1.15);
  const y = (v: number) => box.y1 - (v / yMax) * (box.y1 - box.y0);

  const paths: string[] = [];
  let current: string[] = [];
  for (const p of sorted) {
    if (p.value === null) {
      if (current.length > 1) paths.push(current.join(' '));
      current = [];
      continue;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${round(x(p.at))},${round(y(p.value))}`);
  }
  if (current.length > 1) paths.push(current.join(' '));

  return {
    paths,
    dots: known.map((p) => ({ x: round(x(p.at)), y: round(y(p.value)), at: p.at, value: p.value })),
    gaps: sorted.filter((p) => p.value === null).map((p) => ({ x: round(x(p.at)), at: p.at })),
    yMax,
  };
}

export interface Segment {
  key: string;
  value: number;
  x: number;
  width: number;
}

/**
 * Lays out a stacked bar of `total` width with a gap between segments.
 * Zero-valued segments take no space.
 */
export function stack(parts: { key: string; value: number }[], width: number, gap: number): Segment[] {
  const shown = parts.filter((p) => p.value > 0);
  const sum = shown.reduce((a, p) => a + p.value, 0);
  if (sum === 0) return [];
  const usable = width - gap * (shown.length - 1);
  let x = 0;
  return shown.map((p) => {
    const w = (p.value / sum) * usable;
    const seg = { key: p.key, value: p.value, x: round(x), width: round(w) };
    x += w + gap;
    return seg;
  });
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
