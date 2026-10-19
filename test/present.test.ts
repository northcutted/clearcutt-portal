import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reproducedTone, type Tone } from '../src/lib/present.ts';

test('the Reproduced count is green only when every image with a recipe reproduced', () => {
  const cases: [string, { reproduced: number; notReproduced: number; notChecked: number; noRecipe: number }, Tone][] = [
    ['all reproduced', { reproduced: 4, notReproduced: 0, notChecked: 0, noRecipe: 4 }, 'good'],
    ['none reproduced, none checked', { reproduced: 0, notReproduced: 0, notChecked: 4, noRecipe: 0 }, 'unknown'],
    ['some not checked', { reproduced: 3, notReproduced: 0, notChecked: 1, noRecipe: 0 }, 'unknown'],
    ['one did not reproduce', { reproduced: 3, notReproduced: 1, notChecked: 0, noRecipe: 0 }, 'bad'],
    ['one did not reproduce, others unchecked', { reproduced: 0, notReproduced: 1, notChecked: 3, noRecipe: 0 }, 'bad'],
    ['nothing to rebuild', { reproduced: 0, notReproduced: 0, notChecked: 0, noRecipe: 5 }, 'muted'],
    ['an empty estate', { reproduced: 0, notReproduced: 0, notChecked: 0, noRecipe: 0 }, 'muted'],
  ];
  for (const [name, counts, want] of cases) assert.equal(reproducedTone(counts), want, name);
});
