-- Realtime authorization (T8): the staff heartbeat channel.
-- Private broadcast channels are authorised by RLS on realtime.messages: when a client joins
-- topic X, Realtime checks SELECT with realtime.topic() = X as that user.
--
-- Access is decided by public.my_role() (profiles, by auth.uid()), NEVER by the JWT app_role
-- claim: the claim is for UI routing only and stays stale until the token expires, while
-- my_role() returns NULL the moment staff are deactivated (plan section 5, P1 requirement 3).
--
-- Receive only. There is no INSERT or UPDATE policy, so clients cannot broadcast on private
-- channels; server-side triggers do that from P1.

create policy staff_heartbeat_receive
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'staff:heartbeat'
    and (select public.my_role()) is not null
  );

comment on policy staff_heartbeat_receive on realtime.messages is
  'Any active staff member may join the private staff:heartbeat channel (my_role(), not the JWT).';
