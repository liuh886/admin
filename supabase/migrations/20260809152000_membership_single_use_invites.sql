create table public.membership_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  product_codes text[] not null check (cardinality(product_codes) > 0),
  duration_days integer not null check (duration_days >= 1 and duration_days <= 730),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  redeemed_by uuid references auth.users(id) on delete restrict,
  redeemed_at timestamptz,
  constraint membership_invites_redemption_pair check (
    (redeemed_by is null and redeemed_at is null)
    or (redeemed_by is not null)
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
