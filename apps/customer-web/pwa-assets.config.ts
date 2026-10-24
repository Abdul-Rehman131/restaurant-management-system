// `pnpm brand:icons` generates favicon and Apple touch icon from the logo mark. Re-run after
// replacing public/brand/logo-mark.svg, then commit the PNGs.
import { brandTokens } from '@rms/ui/brand-tokens';
import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config';

const { brand } = brandTokens();

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...preset,
    maskable: { ...preset.maskable, resizeOptions: { background: brand } },
    apple: { ...preset.apple, resizeOptions: { background: brand } },
  },
  images: ['public/brand/logo-mark.svg'],
});
