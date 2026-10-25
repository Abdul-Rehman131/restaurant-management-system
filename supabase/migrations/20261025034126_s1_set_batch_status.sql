-- set_batch_status (M6, BR-08, G3): the kitchen marks one batch Preparing, then Ready. The
-- order status is derived from all its batches in the same transaction (private.
-- sync_order_status): the order is Ready only when every batch is Ready (BR-08).
-- Pattern: docs/adr/001-business-logic-in-postgres.md.
--
-- Allowed: Sent -> Preparing -> Ready (spec 6.4: Accepted -> Preparing -> Ready). Served is
-- set by set_order_status, Cancelled by the cancel functions.
-- Returns {batch_id, order_id, batch_no, batch_status, order_status, replayed}.
-- Errors (P0001 unless noted): NOT_AUTHORIZED (42501), REQUEST_ID_REQUIRED,
--   REQUEST_ID_CONFLICT, BATCH_NOT_FOUND, ORDER_CLOSED, BATCH_STATUS_INVALID,
--   BATCH_TRANSITION_NOT_ALLOWED.
create function public.set_batch_status(
  p_request_id uuid,
  p_batch_id uuid,
  p_status public.batch_status
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := private.require_role('admin', 'cashier', 'chef');
  v_replay jsonb;
  v_batch public.order_batches%rowtype;
  v_order_status public.order_status;
begin
  v_replay := private.replay('set_batch_status', p_request_id, p_batch_id,
    jsonb_build_object('status', p_status));
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_batch from public.order_batches where id = p_batch_id;
  if not found then
    raise exception 'BATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Lock the order first, then the batch (the same order every order function uses).
  perform private.lock_open_order(v_batch.order_id, v_role);
  select * into v_batch from public.order_batches where id = p_batch_id for update;

  if p_status is null or p_status not in ('preparing', 'ready') then
    raise exception 'BATCH_STATUS_INVALID' using errcode = 'P0001';
  end if;
  if not ((v_batch.status = 'sent' and p_status = 'preparing')
          or (v_batch.status = 'preparing' and p_status = 'ready')) then
    raise exception 'BATCH_TRANSITION_NOT_ALLOWED' using errcode = 'P0001',
      detail = format('%s -> %s', v_batch.status, p_status);
  end if;

  update public.order_batches b
     set status = p_status,
         preparing_at = case when p_status = 'preparing' then now() else b.preparing_at end,
         ready_at = case when p_status = 'ready' then now() else b.ready_at end
   where b.id = p_batch_id;

  v_order_status := private.sync_order_status(v_batch.order_id, auth.uid(), null);

  return private.remember('set_batch_status', p_request_id, p_batch_id, jsonb_build_object(
    'batch_id', v_batch.id,
    'order_id', v_batch.order_id,
    'batch_no', v_batch.batch_no,
    'batch_status', p_status,
    'order_status', v_order_status
  ), jsonb_build_object('status', p_status));
end;
$$;

comment on function public.set_batch_status(uuid, uuid, public.batch_status) is
  'Kitchen: marks a batch Preparing or Ready; the order status follows its batches (BR-08, G3, BR-15). See ADR 001.';

revoke all on function public.set_batch_status(uuid, uuid, public.batch_status) from public, anon;
grant execute on function public.set_batch_status(uuid, uuid, public.batch_status) to authenticated;
