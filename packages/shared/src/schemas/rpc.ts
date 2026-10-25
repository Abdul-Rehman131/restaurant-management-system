/**
 * Zod response schemas for every jsonb RPC (ADR 002, condition 1), imported as
 * `import { rpc } from '@rms/shared'` and used as `z.parse(rpc.createOrderResponse, data)`.
 * get_settings keeps its own parser (parseSettings) because it also maps to camelCase.
 */
export * from './common';
export * from './orders';
