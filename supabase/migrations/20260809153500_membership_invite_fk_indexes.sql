drop index if exists public.membership_invites_redeemed_idx;

create index membership_invites_product_code_idx
  on public.membership_invites (product_code);

create index membership_invites_created_by_idx
  on public.membership_invites (created_by);

create index membership_invites_redeemed_by_idx
  on public.membership_invites (redeemed_by)
  where redeemed_by is not null;
