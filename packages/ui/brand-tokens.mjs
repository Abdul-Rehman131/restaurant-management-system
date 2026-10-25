// Build-time helpers (Node): read token values from brand.css and tokens.css so the PWA
// manifest, <meta name="theme-color">, icon backgrounds and the contrast check never
// duplicate a colour.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cssFiles = ['./src/brand.css', './src/tokens.css'].map((path) =>
  fileURLToPath(new URL(path, import.meta.url)),
);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Custom properties declared in the top-level `selector { ... }` blocks of one CSS file. */
function varsIn(cssPath, selector) {
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = {};
  const blocks = new RegExp(`(?:^|[\\s}])${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'g');
  for (const [, body] of css.matchAll(blocks)) {
    for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name] = value.trim();
    }
  }
  return vars;
}

/**
 * Resolved custom properties for a theme ('light' reads `:root`, 'dark' reads `:root` then
 * `.dark`), across brand.css and tokens.css. `var(--x)` references are resolved.
 */
export function readTokens(theme = 'light') {
  const selectors = theme === 'dark' ? [':root', '.dark'] : [':root'];
  const raw = {};
  for (const selector of selectors) {
    for (const path of cssFiles) Object.assign(raw, varsIn(path, selector));
  }
  const resolve = (value, seen = new Set()) =>
    value.replace(/var\(--([\w-]+)\)/g, (_, name) => {
      if (seen.has(name) || raw[name] === undefined) throw new Error(`cannot resolve --${name}`);
      return resolve(raw[name], new Set([...seen, name]));
    });
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, resolve(value)]));
}

export function brandTokens() {
  const light = readTokens('light');
  const dark = readTokens('dark');
  return { brand: light.brand, brandDark: dark.brand, background: light.bg };
}

/** Vite plugin: replaces %BRAND_THEME_COLOR% and %BRAND_THEME_COLOR_DARK% in index.html. */
export function brandHtml() {
  return {
    name: 'rms-brand-html',
    transformIndexHtml(html) {
      const tokens = brandTokens();
      return html
        .replaceAll('%BRAND_THEME_COLOR_DARK%', tokens.brandDark)
        .replaceAll('%BRAND_THEME_COLOR%', tokens.brand);
    },
  };
}
