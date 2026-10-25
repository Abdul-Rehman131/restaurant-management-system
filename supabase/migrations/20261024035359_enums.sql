-- Enums for roles, order lifecycle, payments and pricing rules (spec 9.1: statuses, roles and
-- order types are database enums). Only values used by P0/P1 are defined; later phases add
-- values with `alter type ... add value` (for example table_status 'reserved' in P3).

create type public.app_role as enum ('admin', 'cashier', 'waiter', 'chef', 'rider');

create type public.order_type as enum ('dine_in', 'take_away', 'delivery');

create type public.order_source as enum ('staff', 'website');

-- Spec 6.4. Delivery states exist now so the order status column never needs a type swap.
create type public.order_status as enum (
  'pending',
  'accepted',
  'preparing',
  'ready',
  'served',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'completed',
  'cancelled'
);

-- Kitchen state per batch (G2/G3): the order status is derived from its batches.
create type public.batch_status as enum ('sent', 'preparing', 'ready', 'served', 'cancelled');

create type public.payment_status as enum ('unpaid', 'paid');

create type public.payment_method as enum ('cash', 'card');

-- G13: written only by order functions, in the same transaction as the order change.
create type public.table_status as enum ('available', 'occupied', 'bill_requested');

-- Q1 (assumed, to be confirmed): how calculated charges are rounded. See docs/pricing-rules.md.
create type public.rounding_mode as enum ('half_up', 'half_even', 'up', 'down');
