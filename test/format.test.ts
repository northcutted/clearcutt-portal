import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTimes, formatEpochDay } from '../src/lib/format.ts';

test('times sort by the instant they name, not their text', () => {
  const cases: [string, string, '<' | '=' | '>'][] = [
    // An offset: 18:00+02:00 is 16:00Z, before 17:00Z, though "18" > "17".
    ['2026-10-10T18:00:00+02:00', '2026-10-10T17:00:00Z', '<'],
    // A fractional second: 46.5 is after 46, though "." < "Z".
    ['2026-10-10T16:51:46.5Z', '2026-10-10T16:51:46Z', '>'],
    ['2026-10-10T16:51:46.123Z', '2026-10-10T16:51:46.9Z', '<'],
    // Lower-case t and z are RFC 3339 too.
    ['2026-10-10t16:51:46z', '2026-10-10T16:51:46Z', '='],
    ['2026-10-10T16:51:46-01:00', '2026-10-10T17:51:46Z', '='],
    // What doesn't parse comes first, in text order.
    ['nope', '2026-10-10T16:51:46Z', '<'],
    ['2026-10-10T16:51:46Z', 'nope', '>'],
    ['a', 'b', '<'],
  ];
  for (const [a, b, want] of cases) {
    const got = Math.sign(compareTimes(a, b));
    assert.equal(got, { '<': -1, '=': 0, '>': 1 }[want], `${a} ${want} ${b}`);
  }
});

test('a Unix time becomes a day, or nothing when no four-digit year holds it', () => {
  const cases: [number, string | undefined][] = [
    [0, '1970-01-01'],
    [1791504000, '2026-10-09'],
    [253402300799, '9999-12-31'],
    [253402300800, undefined],
    [-62167219200, '0000-01-01'],
    [-62167219201, undefined],
    // new Date(1e23).toISOString() throws a RangeError.
    [1e20, undefined],
    [-1e20, undefined],
    [Number.MAX_SAFE_INTEGER, undefined],
    [Infinity, undefined],
    [NaN, undefined],
  ];
  for (const [seconds, want] of cases) assert.equal(formatEpochDay(seconds), want, String(seconds));
});
