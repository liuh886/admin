create table public.membership_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  product_code text not null references public.billing_products(product_code) on update cascade on delete restrict,
  entitlement_codes text[] not null check (cardinality(entitlement_codes) > 0),
  duration_days integer check (duration_days is null or (duration_days >= 1 and duration_days <= 3650)),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  redeemed_by uuid references auth.users(id) on delete restrict,
  redeemed_at timestamptz,
  constraint membership_invites_redemption_pair check (
    (redeemed_by is null and redeemed_at is null)
    or (redeemed_by is not null and redeemed_at is not null)
  )
);

create index membership_invites_created_idx on public.membership_invites (created_at desc);
create index membership_invites_redeemed_idx on public.membership_invites (redeemed_at desc) where redeemed_at is not null;

alter table public.membership_invites enable row level security;
revoke all on public.membership_invites from public, anon, authenticated;
grant select, insert, update on public.membership_invites to service_role;

create policy membership_invites_deny_browser_access
on public.membership_invites
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.redeem_membership_invite(p_token_hash text, p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invite public.membership_invites%rowtype;
  v_product public.billing_products%rowtype;
  v_valid_until timestamptz;
  v_code text;
begin
  select *
  into v_invite
  from public.membership_invites
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Invitation link is invalid.';
  end if;

  if v_invite.redeemed_at is not null then
    raise exception 'Invitation link has already been used.';
  end if;

  select *
  into v_product
  from public.billing_products
  where product_code = v_invite.product_code;

  if not found then
    raise exception 'Invitation product is unavailable.';
  end if;

  v_valid_until := case
    when v_invite.duration_days is null then null
    else now() + make_interval(days => v_invite.duration_days)
  end;

  foreach v_code in array v_invite.entitlement_codes
  loop
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
      p_user_id,
      v_code,
      'invite',
      'invite:' || v_invite.id::text,
      true,
      v_valid_until,
      jsonb_build_object(
        'product_code', v_invite.product_code,
        'invite_id', v_invite.id,
        'invited_by', v_invite.created_by
      ),
      now()
    );
  end loop;

  update public.membership_invites
  set redeemed_by = p_user_id,
      redeemed_at = now()
  where id = v_invite.id;

  perform public.refresh_effective_entitlements(p_user_id);

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'product_code', v_invite.product_code,
    'product_name', v_product.name,
    'app_url', v_product.app_url,
    'entitlement_codes', to_jsonb(v_invite.entitlement_codes),
    'valid_until', v_valid_until
  );
end;
$$;

revoke all on function public.redeem_membership_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_membership_invite(text, uuid) to service_role;
