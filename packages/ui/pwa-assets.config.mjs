// `pnpm brand:icons` generates favicon, PWA (64/192/512), maskable and Apple icons from the
// logo mark into ./brand. Re-run after replacing brand/logo-mark.svg, then commit the PNGs.
// The apps receive ./brand at build time (vite-plugin.mjs), so there is one copy only.
import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config';

import { brandTokens } from './brand-tokens.mjs';

const { brand } = brandTokens();

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...preset,
    // Opaque icons sit on the brand colour, so the safe-zone padding blends with the mark.
    maskable: { ...preset.maskable, resizeOptions: { background: brand } },
    apple: { ...preset.apple, resizeOptions: { background: brand } },
  },
  images: ['brand/logo-mark.svg'],
});
