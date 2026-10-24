import { brandTokens } from '@rms/ui/brand-tokens';
import { rmsUi } from '@rms/ui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const brand = brandTokens();

export default defineConfig(({ mode }) => {
  // Install label for the home screen, set per deployment. The in-app header name still comes
  // from the settings table.
  const appName = loadEnv(mode, import.meta.dirname, 'VITE_').VITE_APP_NAME?.trim() || 'Staff App';

  return {
    plugins: [
      react(),
      tailwindcss(),
      rmsUi(),
      VitePWA({
        registerType: 'prompt',
        // Registered by src/shell/pwa.ts, which shows the "update available" toast.
        injectRegister: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico}'],
          cleanupOutdatedCaches: true,
        },
        includeAssets: ['brand/*.svg', 'brand/*.ico', 'brand/apple-touch-icon-180x180.png'],
        manifest: {
          name: appName,
          short_name: appName,
          description: 'Orders, kitchen, cashier and admin screens.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          theme_color: brand.brand,
          background_color: brand.background,
          icons: [
            { src: '/brand/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: '/brand/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/brand/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/brand/maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
    // The manifest lets `pnpm size` measure each route's chunks (scripts/check-size.mjs).
    build: { manifest: true },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
