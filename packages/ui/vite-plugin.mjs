// Vite plugins every app uses (import from '@rms/ui/vite-plugin'):
//   brand assets  copies packages/ui/brand/* into the app's public/brand/ (gitignored) before
//                 Vite starts, so the logo and icons have ONE source and URLs stay /brand/...
//   brand html    fills %BRAND_THEME_COLOR% placeholders in index.html from brand.css
//   font preload  adds <link rel="preload"> for the Inter file in production builds
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { brandHtml } from './brand-tokens.mjs';

const brandDir = fileURLToPath(new URL('./brand', import.meta.url));

function brandAssets() {
  return {
    name: 'rms-brand-assets',
    enforce: 'pre',
    configResolved(config) {
      if (!config.publicDir) return;
      const target = join(config.publicDir, 'brand');
      rmSync(target, { recursive: true, force: true });
      cpSync(brandDir, target, { recursive: true });
    },
  };
}

function fontPreload() {
  return {
    name: 'rms-font-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const fonts = Object.keys(ctx.bundle ?? {}).filter((file) =>
          /inter-latin-wght-normal[^/]*\.woff2$/.test(file),
        );
        return fonts.map((file) => ({
          tag: 'link',
          attrs: {
            rel: 'preload',
            href: `/${file}`,
            as: 'font',
            type: 'font/woff2',
            crossorigin: '',
          },
          injectTo: 'head',
        }));
      },
    },
  };
}

/** @returns {import('vite').PluginOption[]} */
export function rmsUi() {
  return [brandAssets(), brandHtml(), fontPreload()];
}
