import * as z from 'zod/mini';

import { Constants } from '../database.types';

/**
 * Building blocks for the RPC response schemas. Every RPC returns jsonb (typed `Json` by the
 * generated types), so these schemas are the contract (ADR 002, condition 1). Field names stay
 * snake_case, exactly as the database returns them.
 */
const enums = Constants.public.Enums;

/** Any 8-4-4-4-12 hex id. `z.uuid()` would reject the fixed default-branch id (not RFC 4122). */
export const id = z.guid();
/** Money in minor units (BR-01, hard rule 5): a non-negative safe integer, never a float. */
export const money = z.int().check(z.minimum(0));
export const count = z.int().check(z.minimum(0));
export const timestamp = z.string().check(z.minLength(1));
export const isoDate = z.iso.date();

export const orderStatus = z.enum(enums.order_status);
export const orderType = z.enum(enums.order_type);
export const batchStatus = z.enum(enums.batch_status);
export const paymentStatus = z.enum(enums.payment_status);
export const paymentMethod = z.enum(enums.payment_method);
export const tableStatus = z.enum(enums.table_status);

/** Every mutation says whether the result is a replay of an earlier request id (BR-15). */
export const replayed = z.boolean();
