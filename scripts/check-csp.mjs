// Part of `pnpm size` (after `pnpm build`): the staff app's Content-Security-Policy in
// apps/staff-app/vercel.json must allow every inline <script> of the built index.html by its
// sha256 hash, and never with 'unsafe-inline'. Without this, enforcing the CSP would silently
// drop the pre-paint dark-mode script (a light flash on every dark screen), and any edit to that
// script would break it again. Prints the hash to add when one is missing.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = 'apps/staff-app';
const html = join(app, 'dist', 'index.html');
if (!existsSync(html)) {
  console.error(`check-csp: ${html} not found. Run pnpm build first.`);
  process.exitCode = 1;
} else {
  const vercel = JSON.parse(readFileSync(join(app, 'vercel.json'), 'utf8'));
  const csp = (vercel.headers ?? [])
    .flatMap((rule) => rule.headers)
    .find((header) => /^Content-Security-Policy(-Report-Only)?$/.test(header.key));
  const scriptSrc = csp?.value
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('script-src '));

  const problems = [];
  if (!scriptSrc) problems.push('vercel.json has no CSP with a script-src directive');
  else if (scriptSrc.includes("'unsafe-inline'"))
    problems.push("script-src allows 'unsafe-inline'");

  const inline = [
    ...readFileSync(html, 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ];
  for (const [, body] of inline) {
    const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    if (scriptSrc && !scriptSrc.split(/\s+/).includes(hash)) {
      problems.push(`an inline script in index.html is not allowed: add ${hash} to script-src`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.log(`FAIL  staff-app CSP: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(
      ` ok   staff-app CSP: ${String(inline.length)} inline script(s) allowed by hash, no 'unsafe-inline'`,
    );
  }
}
