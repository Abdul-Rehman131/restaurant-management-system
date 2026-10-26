import { enrolTotp, psql } from './support';

/**
 * Admin MFA for the suite (S5: every Admin needs aal2). The seed Admin gets a fresh TOTP factor
 * through the Auth API before the tests start; its secret goes to every worker in
 * E2E_ADMIN_TOTP_SECRET, so signInAs and apiAs can make codes (e2e/totp.ts). An older factor
 * (an earlier run, or one set up by hand on this machine) is removed first: after an e2e run,
 * the local demo Admin enrols again at the next manual sign-in.
 */
export default async function globalSetup() {
  psql(`delete from auth.mfa_factors
         where user_id = (select id from auth.users where email = 'admin@staff.invalid')`);
  process.env['E2E_ADMIN_TOTP_SECRET'] = await enrolTotp('admin');
}
