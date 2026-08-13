-- Hao Apps product referrals.
-- Stable user x product referral identity and one-time invitee attribution.
-- Referral benefit policy stays on billing_products.metadata.referral_trial_days.

create table if not exists public.product_referral_codes (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.billing_products(product_code) on delete cascade,
  referral_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_code),
  constraint product_referral_codes_code_unique unique (referral_code),
  constraint product_referral_codes_product_code_unique unique (product_code, referral_code),
  constraint product_referral_codes_code_format check (referral_code ~ '^R-[A-Z0-9]{12}$')
);

create index if not exists product_referral_codes_product_idx
  on public.product_referral_codes (product_code, created_at desc);

alter table public.product_referral_codes enable row level security;
revoke all on table public.product_referral_codes from anon, authenticated;

drop policy if exists "Browser roles cannot read product referral codes" on public.product_referral_codes;
create policy "Browser roles cannot read product referral codes"
  on public.product_referral_codes
  as restrictive
  for select
  to anon, authenticated
  using (false);

create table if not exists public.product_referral_attributions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_code text not null,
  invitee_user_id uuid not null references auth.users(id) on delete restrict,
  inviter_user_id uuid not null references auth.users(id) on delete restrict,
  referral_code text not null,
  accepted_at timestamptz not null default now(),
  benefit_granted boolean not null default false,
  pro_trial_days integer not null default 0,
  pro_valid_until timestamptz,
  constraint product_referral_attributions_invitee_unique unique (product_code, invitee_user_id),
  constraint product_referral_attributions_code_fk
    foreign key (product_code, referral_code)
    references public.product_referral_codes(product_code, referral_code)
    on delete restrict,
  constraint product_referral_attributions_no_self check (invitee_user_id <> inviter_user_id),
  constraint product_referral_attributions_trial_days check (pro_trial_days between 0 and 730),
  constraint product_referral_attributions_benefit_consistency check (
    (benefit_granted and pro_trial_days > 0 and pro_valid_until is not null)
    or
    (not benefit_granted and pro_trial_days = 0 and pro_valid_until is null)
  )
);

create index if not exists product_referral_attributions_inviter_idx
  on public.product_referral_attributions (inviter_user_id, product_code, accepted_at desc);
create index if not exists product_referral_attributions_code_idx
  on public.product_referral_attributions (product_code, referral_code);
create index if not exists product_referral_attributions_invitee_idx
  on public.product_referral_attributions (invitee_user_id);

alter table public.product_referral_attributions enable row level security;
revoke all on table public.product_referral_attributions from anon, authenticated;

drop policy if exists "Browser roles cannot read product referral attributions" on public.product_referral_attributions;
create policy "Browser roles cannot read product referral attributions"
  on public.product_referral_attributions
  as restrictive
  for select
  to anon, authenticated
  using (false);

create or replace function public.redeem_product_referral(
  p_invitee_user_id uuid,
  p_referral_code text
)
returns table (
  product_code text,
  benefit_granted boolean,
  trial_days integer,
  valid_until timestamptz,
  attribution_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_code public.product_referral_codes%rowtype;
  v_product public.billing_products%rowtype;
  v_entitlement_code text;
  v_trial_days integer := 0;
  v_valid_until timestamptz := null;
  v_benefit boolean := false;
  v_attribution_id uuid := pg_catalog.gen_random_uuid();
  v_inserted_id uuid;
  v_existing public.product_referral_attributions%rowtype;
  v_policy_text text;
begin
  if p_invitee_user_id is null then
    raise exception 'authenticated invitee required' using errcode = '42501';
  end if;

  select c.*
  into v_code
  from public.product_referral_codes c
  where c.referral_code = upper(trim(p_referral_code))
  for share;

  if not found then
    raise exception 'referral code is invalid' using errcode = '23514';
  end if;

  if v_code.user_id = p_invitee_user_id then
    raise exception 'self-referral is not allowed' using errcode = '23514';
  end if;

  select p.*
  into v_product
  from public.billing_products p
  where p.product_code = v_code.product_code
    and p.active = true;

  if not found then
    raise exception 'referral product is inactive' using errcode = '23514';
  end if;

  select e.entitlement_code
  into v_entitlement_code
  from public.billing_product_entitlements e
  where e.product_code = v_code.product_code
    and e.entitlement_code like '%.pro'
  order by e.entitlement_code
  limit 1;

  if v_entitlement_code is null then
    raise exception 'referral product has no Pro entitlement mapping' using errcode = '23514';
  end if;

  v_policy_text := coalesce(v_product.metadata ->> 'referral_trial_days', '');
  if v_policy_text ~ '^[0-9]{1,3}$' then
    v_trial_days := least(730, greatest(0, v_policy_text::integer));
  end if;

  if not exists (
    select 1
    from public.entitlements e
    where e.user_id = v_code.user_id
      and e.entitlement_code = v_entitlement_code
      and e.active = true
      and (e.valid_until is null or e.valid_until > now())
  ) then
    v_trial_days := 0;
  end if;

  if v_trial_days > 0
     and not exists (
       select 1
       from public.subscriptions s
       where s.user_id = p_invitee_user_id
         and s.product_code = v_code.product_code
     )
     and not exists (
       select 1
       from public.entitlement_grants g
       where g.user_id = p_invitee_user_id
         and g.entitlement_code = v_entitlement_code
     )
  then
    v_benefit := true;
    v_valid_until := now() + pg_catalog.make_interval(days => v_trial_days);
  else
    v_trial_days := 0;
  end if;

  insert into public.product_referral_attributions (
    id,
    product_code,
    invitee_user_id,
    inviter_user_id,
    referral_code,
    benefit_granted,
    pro_trial_days,
    pro_valid_until
  ) values (
    v_attribution_id,
    v_code.product_code,
    p_invitee_user_id,
    v_code.user_id,
    v_code.referral_code,
    v_benefit,
    v_trial_days,
    v_valid_until
  )
  on conflict on constraint product_referral_attributions_invitee_unique do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    select a.*
    into v_existing
    from public.product_referral_attributions a
    where a.product_code = v_code.product_code
      and a.invitee_user_id = p_invitee_user_id;

    return query
      select
        v_existing.product_code,
        v_existing.benefit_granted,
        v_existing.pro_trial_days,
        v_existing.pro_valid_until,
        v_existing.id;
    return;
  end if;

  if v_benefit then
    insert into public.entitlement_grants (
      user_id,
      entitlement_code,
      source,
      source_ref,
      active,
      valid_until,
      metadata,
      updated_at
    ) values (
      p_invitee_user_id,
      v_entitlement_code,
      'product_referral',
      v_attribution_id::text,
      true,
      v_valid_until,
      pg_catalog.jsonb_build_object(
        'product_code', v_code.product_code,
        'inviter_user_id', v_code.user_id,
        'referral_code', v_code.referral_code,
        'trial_days', v_trial_days
      ),
      now()
    );

    perform public.refresh_effective_entitlements(p_invitee_user_id);
  end if;

  return query
    select
      v_code.product_code,
      v_benefit,
      v_trial_days,
      v_valid_until,
      v_attribution_id;
end;
$$;

revoke all on function public.redeem_product_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_product_referral(uuid, text) to service_role;

comment on table public.product_referral_codes is
  'Stable Hao Apps user x product referral identity. Browser roles cannot read or mutate this table directly.';
comment on table public.product_referral_attributions is
  'One accepted referral attribution per invitee x product, including server-authoritative complimentary Pro outcome.';
