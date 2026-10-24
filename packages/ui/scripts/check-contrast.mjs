// Contrast check for both themes (WCAG 2.2 AA): text 4.5:1, UI parts and focus rings 3:1.
// Reads the real values from src/brand.css and src/tokens.css, so a new --brand is checked
// automatically. Exits 1 on any failure (CI). Run: pnpm --filter @rms/ui test
import { readTokens } from '../brand-tokens.mjs';

const TEXT = 4.5;
const UI = 3;

// [foreground, background, minimum ratio, what it is]
const pairs = [
  ...['bg', 'surface', 'surface-2', 'surface-raised'].flatMap((bg) => [
    ['text', bg, TEXT, 'body text'],
    ['text-muted', bg, TEXT, 'secondary text'],
    ['input', bg, UI, 'field border'],
    ['ring', bg, UI, 'focus ring'],
  ]),
  ['brand-fg', 'brand', TEXT, 'text on brand buttons'],
  ['brand', 'bg', TEXT, 'brand text and links on the page'],
  ['brand', 'surface', TEXT, 'brand text and links on cards'],
  ['accent-fg', 'accent', TEXT, 'text on accent'],
  ['danger-fg', 'danger', TEXT, 'text on destructive buttons'],
  ...['success', 'warning', 'danger', 'info'].flatMap((tone) => [
    [tone, `${tone}-bg`, TEXT, `${tone} badge text`],
    [tone, 'surface', TEXT, `${tone} text and icons on cards`],
    [tone, 'bg', TEXT, `${tone} text and icons on the page`],
  ]),
];

function parseColor(value) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (!hex) throw new Error(`only #rgb or #rrggbb colours can be checked, got "${value}"`);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

function luminance(value) {
  const [r, g, b] = parseColor(value).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let failures = 0;
for (const theme of ['light', 'dark']) {
  const tokens = readTokens(theme);
  console.log(`\n${theme} theme`);
  for (const [fg, bg, min, label] of pairs) {
    const ratio = contrast(tokens[fg], tokens[bg]);
    const ok = ratio >= min;
    if (!ok) failures += 1;
    console.log(
      `${ok ? ' ok ' : 'FAIL'}  ${ratio.toFixed(2).padStart(5)}:1 (min ${min})  --${fg} on --${bg}  ${label}`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} contrast check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${pairs.length * 2} contrast checks passed.`);
