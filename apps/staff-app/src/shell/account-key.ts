/** The TanStack Query key of public.my_account(): its own module so screens outside the shell
 * (the MFA step) can drop the cached answer without loading the data client. */
export const accountKey = ['my-account'] as const;
