import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useRpcAction } from '../../lib/useRpcAction';

/** useRpcAction that refetches the given queries after the server confirms. */
export function useAdminAction<A extends unknown[], R>(
  call: (requestId: string, ...args: A) => Promise<R>,
  refetch: QueryKey,
  onDone?: (result: R) => unknown,
) {
  const queryClient = useQueryClient();
  const done = useCallback(
    async (result: R) => {
      await queryClient.refetchQueries({ queryKey: refetch });
      await onDone?.(result);
    },
    [queryClient, refetch, onDone],
  );
  return useRpcAction(call, done);
}
