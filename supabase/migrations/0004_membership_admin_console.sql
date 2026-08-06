-- Owner-only administration layer for Hao Apps membership operations.
-- The public web console never receives service-role or Stripe secrets.

create table if not exists public.membership_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner', 'operator', 'viewer')),
  active boolean not null default true,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.membership_admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action_type text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_email text,
  product_code text,
  entitlement_code text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_payment_intent_id text,
  amount integer,
  currency text,
  reason text,
  status text not null default 'completed' check (status in ('requested', 'completed', 'failed')),
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists membership_admin_actions_created_idx
  on public.membership_admin_actions (created_at desc);
create index if not exists membership_admin_actions_target_idx
  on public.membership_admin_actions (target_user_id, created_at desc);

create or replace function public.block_membership_admin_action_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'membership_admin_actions is append-only';
end;
$$;

drop trigger if exists membership_admin_actions_immutable on public.membership_admin_actions;
create trigger membership_admin_actions_immutable
before update or delete on public.membership_admin_actions
for each row execute function public.block_membership_admin_action_mutation();

alter table public.membership_admins enable row level security;
alter table public.membership_admin_actions enable row level security;

revoke all on public.membership_admins from public, anon, authenticated;
revoke all on public.membership_admin_actions from public, anon, authenticated;
revoke all on function public.block_membership_admin_action_mutation() from public, anon, authenticated;

grant select, insert, update, delete on public.membership_admins to service_role;
grant select, insert on public.membership_admin_actions to service_role;

-- Resolve the initial owner by email instead of hard-coding a generated auth UUID.
insert into public.membership_admins (user_id, role, active, note, created_by)
select id, 'owner', true, 'Initial Hao Apps membership owner', id
from auth.users
where lower(email) = lower('liuh886@gmail.com')
on conflict (user_id) do update
set role = 'owner',
    active = true,
    note = excluded.note,
    updated_at = now();
