// The status glyphs are text, so each must have 4.5:1 contrast (WCAG 2.1
// 1.4.3) on every surface it is drawn on, in both themes. The colors come
// from the stylesheet itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { root } from './helpers.ts';

type RGB = [number, number, number];

/** The custom properties of every `selector { … }` block, merged in order. */
function variables(css: string, selector: string): Map<string, RGB> {
  const out = new Map<string, RGB>();
  const blocks = css.matchAll(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'g'));
  for (const [, body] of blocks) {
    for (const m of body.matchAll(/--([a-z0-9-]+):\s*(\d+) (\d+) (\d+);/g)) {
      out.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
    }
  }
  return out;
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `fg` at `alpha` over `bg`, as the browser composites rgb(… / alpha). */
const over = (fg: RGB, alpha: number, bg: RGB): RGB => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as RGB;

const css = readFileSync(path.join(root, 'src/styles/global.css'), 'utf8');
const TONES = ['good', 'claim', 'warn', 'bad', 'unknown', 'muted'];

for (const theme of ['light', 'dark']) {
  test(`every status glyph has 4.5:1 contrast in the ${theme} theme`, () => {
    const vars = variables(css, ':root');
    if (theme === 'dark') for (const [k, v] of variables(css, '.dark')) vars.set(k, v);
    const page = vars.get('ink-950')!;
    const ink900 = vars.get('ink-900')!;
    // Where glyphs are drawn: the page, cards and tiles (ink-900 at .55),
    // table headers (.7), hovered rows (.45), and a status cell's tint of its
    // own tone (.12), on the page and on a hovered row.
    const surfaces: [string, (tone: RGB) => RGB][] = [
      ['page', () => page],
      ['card', () => over(ink900, 0.55, page)],
      ['table header', () => over(ink900, 0.7, page)],
      ['hovered row', () => over(ink900, 0.45, page)],
      ['status cell', (tone) => over(tone, 0.12, page)],
      ['status cell, hovered row', (tone) => over(tone, 0.12, over(ink900, 0.45, page))],
    ];
    for (const tone of TONES) {
      const glyph = vars.get(`glyph-${tone}`);
      const tint = vars.get(`tone-${tone}`);
      assert.ok(glyph && tint, `--glyph-${tone} and --tone-${tone} are set`);
      for (const [name, surface] of surfaces) {
        const ratio = contrast(glyph, surface(tint));
        assert.ok(ratio >= 4.5, `${theme} ${tone} glyph on ${name}: ${ratio.toFixed(2)}:1`);
      }
    }
  });
}

test('glyphs are drawn in their glyph color, not the tint', () => {
  assert.match(css, /\.chip-glyph \{\s*color: rgb\(var\(--glyph, var\(--ink-300\)\)\);/);
  assert.match(css, /\.cell-status \{[^}]*\n\s*color: rgb\(var\(--glyph\)\);/);
  for (const tone of TONES) assert.match(css, new RegExp(`\\.tone-${tone} \\{\\s*--tone: var\\(--tone-${tone}\\);\\s*--glyph: var\\(--glyph-${tone}\\);`));
});
