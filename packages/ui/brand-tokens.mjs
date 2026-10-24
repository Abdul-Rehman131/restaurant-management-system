// Build-time helpers (Node, used by vite.config.ts): read brand values from brand.css so the
// PWA manifest, <meta name="theme-color"> and icon backgrounds never duplicate a colour.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const brandCssPath = fileURLToPath(new URL('./src/brand.css', import.meta.url));
const tokensCssPath = fileURLToPath(new URL('./src/tokens.css', import.meta.url));

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readVar(cssPath, selector, name) {
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = new RegExp(`(?:^|[\\s}])${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  const value = block && new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  if (!value) throw new Error(`--${name} not found in "${selector}" of ${cssPath}`);
  return value;
}

export function brandTokens() {
  return {
    brand: readVar(brandCssPath, ':root', 'brand'),
    brandDark: readVar(brandCssPath, '.dark', 'brand'),
    background: readVar(tokensCssPath, ':root', 'bg'),
  };
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
