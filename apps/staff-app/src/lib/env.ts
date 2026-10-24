// Browser-safe settings only (CLAUDE.md rule 4). Locally they come from apps/staff-app/.env.local
// (copied from `pnpm db:status`); deployments set them in Vercel.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are missing. Copy .env.example to apps/staff-app/.env.local and fill them in from `pnpm db:status`.',
  );
}

// A secret or service-role key must never reach the browser: refuse to start with one.
function isPrivilegedKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  const payload = value.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: unknown;
    };
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}
if (isPrivilegedKey(key)) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is a secret key. Use the publishable key.');
}

export const supabaseUrl = url;
export const supabaseKey = key;
