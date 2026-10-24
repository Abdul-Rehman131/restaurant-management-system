import { brandHtml } from '@rms/ui/brand-tokens';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
});
