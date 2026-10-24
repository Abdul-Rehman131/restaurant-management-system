import { QueryClient } from '@tanstack/react-query';

// Server state lives here (TanStack Query); Zustand is only for cart and UI state (CLAUDE.md).
// Realtime events only invalidate queries, and a reconnect refetches everything visible
// (plan 4.6 rule 7).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: 'always',
    },
    mutations: {
      // Mutations carry a request_id and are idempotent, but retries are decided per screen.
      retry: false,
    },
  },
});
