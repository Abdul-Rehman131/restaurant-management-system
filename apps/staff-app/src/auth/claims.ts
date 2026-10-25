import { Constants } from '@rms/shared';

import type { AppRole } from './auth-context';

interface Claims {
  role: AppRole | null;
  aal: 'aal1' | 'aal2' | null;
}

/**
 * Reads the access token's claims without verifying them (the server verifies every request).
 * Used only to choose which screen to show.
 */
export function readClaims(accessToken: string): Claims {
  try {
    const payload = accessToken.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { app_role?: unknown; aal?: unknown };
    const role = Constants.public.Enums.app_role.find((r) => r === claims.app_role) ?? null;
    const aal = claims.aal === 'aal1' || claims.aal === 'aal2' ? claims.aal : null;
    return { role, aal };
  } catch {
    return { role: null, aal: null };
  }
}
