// Bundle budgets (plan 4.10), checked after `pnpm build`: the gzip size of the JavaScript each
// app's index.html loads before first render (entry script + modulepreloads). Lazy chunks are
// not counted here; per-role chunk budgets are added with the role routes (T8). Exits 1 on
// failure. Run: pnpm build && pnpm size
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const apps = [
  { name: 'staff-app', initialBudget: 180 * KB },
  { name: 'customer-web', initialBudget: 200 * KB },
];
// Development-only code that must never reach a production bundle.
const devOnlyMarkers = ['rms-dev-only'];

const gzip = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

let failed = false;
for (const { name, initialBudget } of apps) {
  const dist = join('apps', name, 'dist');
  const indexHtml = join(dist, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error(`${name}: ${indexHtml} not found. Run pnpm build first.`);
    failed = true;
    continue;
  }

  const html = readFileSync(indexHtml, 'utf8');
  const initial = [
    ...html.matchAll(/<script[^>]+type="module"[^>]+src="\/([^"]+\.js)"/g),
    ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+\.js)"/g),
  ].map((match) => match[1]);
  const initialBytes = [...new Set(initial)].reduce((sum, file) => sum + gzip(join(dist, file)), 0);
  const ok = initialBytes <= initialBudget;
  failed ||= !ok;
  console.log(
    `${ok ? ' ok ' : 'FAIL'}  ${name}: initial JS ${kb(initialBytes)} gzip (budget ${kb(initialBudget)})`,
  );

  const assets = join(dist, 'assets');
  for (const file of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(join(assets, file), 'utf8');
    const marker = devOnlyMarkers.find((m) => code.includes(m));
    if (marker) {
      console.log(`FAIL  ${name}: ${file} contains development-only code ("${marker}")`);
      failed = true;
    }
  }
}

process.exit(failed ? 1 : 0);
