-- The admin console uses only the JWT-protected Edge Function.
-- Browser roles must never access these tables through the Data API.

drop policy if exists "Clients cannot access membership admins" on public.membership_admins;
create policy "Clients cannot access membership admins"
  on public.membership_admins
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "Clients cannot access membership admin actions" on public.membership_admin_actions;
create policy "Clients cannot access membership admin actions"
  on public.membership_admin_actions
  for all
  to anon, authenticated
  using (false)
  with check (false);
