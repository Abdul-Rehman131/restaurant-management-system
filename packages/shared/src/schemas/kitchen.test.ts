import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import { setBatchStatusResponse } from './kitchen';

describe('set_batch_status response', () => {
  const result = {
    batch_id: '6c4d7a0e-3f7b-4f7e-8a51-2a9d0f6c1e33',
    order_id: '2b7f1d5e-8a0c-4c47-9a53-3f0f3c1b9e21',
    batch_no: 2,
    batch_status: 'ready',
    order_status: 'ready',
    replayed: false,
  };

  it('accepts a batch marked Ready', () => {
    expect(z.parse(setBatchStatusResponse, result).order_status).toBe('ready');
  });

  it('rejects an unknown batch status', () => {
    expect(() => z.parse(setBatchStatusResponse, { ...result, batch_status: 'done' })).toThrow();
  });
});
