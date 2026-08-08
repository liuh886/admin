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

-- Owner is an administrative identity. Product access is materialized as permanent *.pro grants,
-- so every product uses the same entitlement path for owners and paying members.
create or replace function public.sync_owner_pro_entitlements(p_user_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_is_owner boolean;
begin
  select exists (
    select 1
    from public.membership_admins a
    where a.user_id = p_user_id
      and a.active
      and a.role = 'owner'
  ) into v_is_owner;

  if v_is_owner then
    insert into public.entitlement_grants (
      user_id,
      entitlement_code,
      source,
      source_ref,
      active,
      valid_until,
      metadata,
      updated_at
    )
    select
      p_user_id,
      mapping.entitlement_code,
      'owner',
      'membership_admin',
      true,
      null,
      jsonb_build_object('reason', 'Membership owner', 'role', 'owner'),
      now()
    from (
      select distinct entitlement_code
      from public.billing_product_entitlements
      where entitlement_code like '%.pro'
    ) mapping
    on conflict (user_id, entitlement_code, source, source_ref) do update
    set active = true,
        valid_until = null,
        metadata = excluded.metadata,
        updated_at = now();

    update public.entitlement_grants g
    set active = false,
        updated_at = now()
    where g.user_id = p_user_id
      and g.source = 'owner'
      and g.source_ref = 'membership_admin'
      and g.entitlement_code not in (
        select entitlement_code
        from public.billing_product_entitlements
        where entitlement_code like '%.pro'
      );
  else
    update public.entitlement_grants g
    set active = false,
        updated_at = now()
    where g.user_id = p_user_id
      and g.source = 'owner'
      and g.source_ref = 'membership_admin'
      and g.active;
  end if;

  perform public.refresh_effective_entitlements(p_user_id);
end;
$$;

revoke all on function public.sync_owner_pro_entitlements(uuid) from public, anon, authenticated;
grant execute on function public.sync_owner_pro_entitlements(uuid) to service_role;

create or replace function public.sync_owner_pro_entitlements_from_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.sync_owner_pro_entitlements(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

revoke all on function public.sync_owner_pro_entitlements_from_admin() from public, anon, authenticated;

drop trigger if exists membership_admin_sync_owner_pro on public.membership_admins;
create trigger membership_admin_sync_owner_pro
after insert or update of role, active or delete on public.membership_admins
for each row execute function public.sync_owner_pro_entitlements_from_admin();

create or replace function public.sync_all_owner_pro_entitlements()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_owner record;
begin
  for v_owner in
    select user_id
    from public.membership_admins
    where active and role = 'owner'
  loop
    perform public.sync_owner_pro_entitlements(v_owner.user_id);
  end loop;
  return null;
end;
$$;

revoke all on function public.sync_all_owner_pro_entitlements() from public, anon, authenticated;

drop trigger if exists billing_mapping_sync_owner_pro on public.billing_product_entitlements;
create trigger billing_mapping_sync_owner_pro
after insert or update or delete on public.billing_product_entitlements
for each statement execute function public.sync_all_owner_pro_entitlements();

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