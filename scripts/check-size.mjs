// Bundle budgets (plan 4.10), checked after `pnpm build`. Sizes are gzip, of the JavaScript a
// device downloads for each path through the app:
//   staff-app (from Vite's build manifest):
//     login      entry + everything the login screen imports        <= 180 KB
//     signed-in  entry + the signed-in shell (data, Realtime, header) <= 180 KB
//     each role  its own chunks beyond the two above                 <= 120 KB (admin 250)
//   customer-web: the JS index.html loads before first render         <= 200 KB
// Also fails if development-only code (the /dev/ui gallery) reaches any production chunk.
// Exits 1 on failure. Run: pnpm build && pnpm size
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const devOnlyMarkers = ['rms-dev-only'];

const staffPaths = [
  { name: 'login (shell + login)', entries: ['src/screens/LoginScreen.tsx'], budget: 180 * KB },
  { name: 'signed-in shell', entries: ['src/shell/SignedIn.tsx'], budget: 180 * KB },
];
// Role chunks are measured beyond the signed-in shell.
const staffRoles = [
  { name: 'role: waiter', entries: ['src/roles/waiter/WaiterApp.tsx'], budget: 120 * KB },
  { name: 'role: kitchen', entries: ['src/roles/kitchen/KitchenApp.tsx'], budget: 120 * KB },
  { name: 'role: cashier', entries: ['src/roles/cashier/CashierApp.tsx'], budget: 120 * KB },
  { name: 'role: admin', entries: ['src/roles/admin/AdminApp.tsx'], budget: 250 * KB },
];

const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;
let failed = false;

function report(ok, label, bytes, budget) {
  failed ||= !ok;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}: ${kb(bytes)} gzip (budget ${kb(budget)})`);
}

function checkDevOnly(app, dist) {
  const assets = join(dist, 'assets');
  for (const file of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(join(assets, file), 'utf8');
    const marker = devOnlyMarkers.find((m) => code.includes(m));
    if (marker) {
      console.log(`FAIL  ${app}: ${file} contains development-only code ("${marker}")`);
      failed = true;
    }
  }
}

function checkStaffApp() {
  const dist = join('apps', 'staff-app', 'dist');
  const manifestPath = join(dist, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`staff-app: ${manifestPath} not found. Run pnpm build first.`);
    failed = true;
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const gz = new Map();
  const size = (file) => {
    if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(dist, file)), { level: 9 }).length);
    return gz.get(file);
  };
  // All JS files a manifest key loads statically (itself plus its static imports, recursively).
  const closure = (keys) => {
    const files = new Set();
    const visit = (key) => {
      const chunk = manifest[key];
      if (!chunk) throw new Error(`staff-app: "${key}" is not in the build manifest`);
      if (files.has(chunk.file)) return;
      if (chunk.file.endsWith('.js')) files.add(chunk.file);
      for (const imported of chunk.imports ?? []) visit(imported);
    };
    keys.forEach(visit);
    return files;
  };
  const total = (files) => [...files].reduce((sum, file) => sum + size(file), 0);
  const entryKeys = Object.keys(manifest).filter((key) => manifest[key].isEntry);
  const entry = closure(entryKeys);

  const signedIn = new Set(entry);
  for (const path of staffPaths) {
    try {
      const files = new Set([...entry, ...closure(path.entries)]);
      if (path.name === 'signed-in shell') files.forEach((f) => signedIn.add(f));
      report(total(files) <= path.budget, `staff-app ${path.name}`, total(files), path.budget);
    } catch (error) {
      console.log(`FAIL  ${error.message}`);
      failed = true;
    }
  }
  for (const role of staffRoles) {
    try {
      const own = [...closure(role.entries)].filter((file) => !signedIn.has(file));
      report(total(own) <= role.budget, `staff-app ${role.name}`, total(own), role.budget);
    } catch (error) {
      console.log(`FAIL  ${error.message}`);
      failed = true;
    }
  }
  checkDevOnly('staff-app', dist);
}

function checkCustomerWeb() {
  const dist = join('apps', 'customer-web', 'dist');
  const indexHtml = join(dist, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error(`customer-web: ${indexHtml} not found. Run pnpm build first.`);
    failed = true;
    return;
  }
  const html = readFileSync(indexHtml, 'utf8');
  const initial = [
    ...html.matchAll(/<script[^>]+type="module"[^>]+src="\/([^"]+\.js)"/g),
    ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+\.js)"/g),
  ].map((match) => match[1]);
  const bytes = [...new Set(initial)].reduce(
    (sum, file) => sum + gzipSync(readFileSync(join(dist, file)), { level: 9 }).length,
    0,
  );
  report(bytes <= 200 * KB, 'customer-web initial JS', bytes, 200 * KB);
  checkDevOnly('customer-web', dist);
}

checkStaffApp();
checkCustomerWeb();
process.exit(failed ? 1 : 0);
