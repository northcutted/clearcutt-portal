import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineGeometry, niceMax, stack } from '../src/lib/charts.ts';

test('niceMax rounds up to 1, 2, or 5 times a power of ten', () => {
  assert.deepEqual([0, 1, 3, 7, 11, 24, 120].map(niceMax), [1, 1, 5, 10, 20, 50, 200]);
});

const box = { x0: 0, x1: 100, y0: 0, y1: 100 };

test('an unknown value breaks the line instead of drawing a zero', () => {
  const g = lineGeometry(
    [
      { at: '2026-10-01T00:00:00Z', value: 4 },
      { at: '2026-10-02T00:00:00Z', value: 5 },
      { at: '2026-10-03T00:00:00Z', value: null },
      { at: '2026-10-04T00:00:00Z', value: 6 },
      { at: '2026-10-05T00:00:00Z', value: 6 },
    ],
    box,
  );
  assert.equal(g.paths.length, 2);
  assert.equal(g.dots.length, 4);
  assert.deepEqual(g.gaps.map((x) => x.at), ['2026-10-03T00:00:00Z']);
  assert.ok(!g.dots.some((d) => d.y === 100), 'no dot sits on the zero line');
});

test('a single run is drawn in the middle', () => {
  const g = lineGeometry([{ at: '2026-10-01T00:00:00Z', value: 3 }], box);
  assert.equal(g.dots[0].x, 50);
  assert.equal(g.paths.length, 0);
});

test('stacked segments skip zeros and keep a gap between the rest', () => {
  const segs = stack(
    [
      { key: 'a', value: 1 },
      { key: 'b', value: 0 },
      { key: 'c', value: 1 },
    ],
    102,
    2,
  );
  assert.deepEqual(segs.map((s) => [s.key, s.x, s.width]), [
    ['a', 0, 50],
    ['c', 52, 50],
  ]);
  assert.deepEqual(stack([{ key: 'a', value: 0 }], 100, 2), []);
});
