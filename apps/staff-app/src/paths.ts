// Route paths in one place (also keeps URLs out of JSX text).
export const paths = {
  home: '/',
  login: '/login',
  mfa: '/login/mfa',
  notAvailable: '/not-available',
  waiter: '/waiter',
  kitchen: '/kitchen',
  cashier: '/cashier',
  admin: '/admin',
} as const;
