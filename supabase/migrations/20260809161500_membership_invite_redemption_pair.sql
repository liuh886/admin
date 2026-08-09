alter table public.membership_invites
  drop constraint if exists membership_invites_redemption_pair;

alter table public.membership_invites
  add constraint membership_invites_redemption_pair check (
    (redeemed_by is null and redeemed_at is null)
    or (redeemed_by is not null and redeemed_at is not null)
  );
