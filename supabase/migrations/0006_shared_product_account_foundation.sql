alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists locale text,
  add column if not exists last_seen_at timestamptz;

comment on table public.profiles is 'Shared Hao Apps profile. Product-specific private content is not stored here.';
comment on column public.profiles.avatar_url is 'Public avatar URL copied from the user identity provider when available.';
comment on column public.profiles.locale is 'User interface locale preference, such as zh or en.';

create table if not exists public.product_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  preferences jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_code),
  constraint product_accounts_product_code_format check (product_code ~ '^[a-z0-9_]{2,64}$'),
  constraint product_accounts_preferences_object check (jsonb_typeof(preferences) = 'object'),
  constraint product_accounts_state_object check (jsonb_typeof(state) = 'object'),
  constraint product_accounts_preferences_size check (octet_length(preferences::text) <= 65536),
  constraint product_accounts_state_size check (octet_length(state::text) <= 65536)
);

comment on table public.product_accounts is 'Small per-product preferences and account state. Large local-first content must not be uploaded here.';

create index if not exists product_accounts_product_last_seen_idx
  on public.product_accounts (product_code, last_seen_at desc);

alter table public.product_accounts enable row level security;

drop policy if exists "Users read own product accounts" on public.product_accounts;
create policy "Users read own product accounts"
  on public.product_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own product accounts" on public.product_accounts;
create policy "Users insert own product accounts"
  on public.product_accounts for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own product accounts" on public.product_accounts;
create policy "Users update own product accounts"
  on public.product_accounts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own product accounts" on public.product_accounts;
create policy "Users delete own product accounts"
  on public.product_accounts for delete to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists product_accounts_set_updated_at on public.product_accounts;
create trigger product_accounts_set_updated_at
  before update on public.product_accounts
  for each row execute function public.set_updated_at();

create table if not exists public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null,
  category text not null default 'general',
  message text not null,
  page_url text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  constraint product_feedback_product_code_format check (product_code ~ '^[a-z0-9_]{2,64}$'),
  constraint product_feedback_category_check check (category in ('general','idea','bug','content','other')),
  constraint product_feedback_message_length check (char_length(message) between 1 and 4000),
  constraint product_feedback_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint product_feedback_metadata_size check (octet_length(metadata::text) <= 32768),
  constraint product_feedback_status_check check (status in ('new','reviewing','planned','resolved','closed'))
);

comment on table public.product_feedback is 'Authenticated product feedback. Users may create and read only their own submissions.';

create index if not exists product_feedback_product_created_idx
  on public.product_feedback (product_code, created_at desc);
create index if not exists product_feedback_user_created_idx
  on public.product_feedback (user_id, created_at desc);

alter table public.product_feedback enable row level security;

drop policy if exists "Users insert own product feedback" on public.product_feedback;
create policy "Users insert own product feedback"
  on public.product_feedback for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'new');

drop policy if exists "Users read own product feedback" on public.product_feedback;
create policy "Users read own product feedback"
  on public.product_feedback for select to authenticated
  using ((select auth.uid()) = user_id);
