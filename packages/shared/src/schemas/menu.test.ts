import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import { setItemAvailabilityResponse } from './menu';

describe('set_item_availability response', () => {
  const result = {
    menu_item_id: '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
    is_available: false,
    replayed: false,
  };

  it('accepts a Sold Out result', () => {
    expect(z.parse(setItemAvailabilityResponse, result).is_available).toBe(false);
  });

  it('rejects a missing flag', () => {
    expect(() => z.parse(setItemAvailabilityResponse, { ...result, is_available: null })).toThrow();
  });
});
