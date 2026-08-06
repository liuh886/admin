create index if not exists membership_admin_actions_actor_user_idx
  on public.membership_admin_actions (actor_user_id);

create index if not exists membership_admins_created_by_idx
  on public.membership_admins (created_by)
  where created_by is not null;
