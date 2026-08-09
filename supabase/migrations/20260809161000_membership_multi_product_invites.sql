drop function if exists public.redeem_membership_invite(text, uuid);

drop index if exists public.membership_invites_product_code_idx;

alter table public.membership_invites
  drop constraint if exists membership_invites_product_code_fkey;

alter table public.membership_invites
  drop column if exists entitlement_codes,
  drop column if exists product_code;

alter table public.membership_invites
  add column product_codes text[] not null
    check (cardinality(product_codes) > 0);

create or replace function public.redeem_membership_invite(p_token_hash text, p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invite public.membership_invites%rowtype;
  v_product public.billing_products%rowtype;
  v_product_code text;
  v_entitlement_code text;
  v_entitlement_codes text[];
  v_valid_until timestamptz;
  v_products jsonb := '[]'::jsonb;
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

  v_valid_until := now() + make_interval(days => v_invite.duration_days);

  for v_product_code in
    select distinct code
    from unnest(v_invite.product_codes) as code
  loop
    select *
    into v_product
    from public.billing_products
    where product_code = v_product_code
      and active;

    if not found then
      raise exception 'Invitation product % is unavailable.', v_product_code;
    end if;

    select array_agg(entitlement_code order by entitlement_code)
    into v_entitlement_codes
    from public.billing_product_entitlements
    where product_code = v_product_code
      and entitlement_code like '%.pro';

    if coalesce(cardinality(v_entitlement_codes), 0) = 0 then
      raise exception 'Invitation product % has no Pro entitlement mapping.', v_product_code;
    end if;

    foreach v_entitlement_code in array v_entitlement_codes
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
        v_entitlement_code,
        'invite',
        'invite:' || v_invite.id::text,
        true,
        v_valid_until,
        jsonb_build_object(
          'product_code', v_product_code,
          'invite_id', v_invite.id,
          'invited_by', v_invite.created_by
        ),
        now()
      );
    end loop;

    v_products := v_products || jsonb_build_array(jsonb_build_object(
      'product_code', v_product.product_code,
      'name', v_product.name,
      'app_url', v_product.app_url,
      'entitlement_codes', to_jsonb(v_entitlement_codes)
    ));
  end loop;

  update public.membership_invites
  set redeemed_by = p_user_id,
      redeemed_at = now()
  where id = v_invite.id;

  perform public.refresh_effective_entitlements(p_user_id);

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'product_codes', to_jsonb(v_invite.product_codes),
    'products', v_products,
    'valid_until', v_valid_until
  );
end;
$$;

revoke all on function public.redeem_membership_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_membership_invite(text, uuid) to service_role;
