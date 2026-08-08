create table if not exists public.rhythmcoach_personal_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  title text not null check (char_length(title) between 1 and 120),
  content text not null check (char_length(content) between 1 and 20000),
  tip text,
  delivery_markup text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists rhythmcoach_personal_materials_user_updated_idx
  on public.rhythmcoach_personal_materials (user_id, updated_at desc);

alter table public.rhythmcoach_personal_materials enable row level security;

grant select, insert, update, delete on public.rhythmcoach_personal_materials to authenticated;
grant all on public.rhythmcoach_personal_materials to service_role;

drop policy if exists "Members read own RhythmCoach materials" on public.rhythmcoach_personal_materials;
create policy "Members read own RhythmCoach materials"
on public.rhythmcoach_personal_materials for select
to authenticated
using (
  (select auth.uid()) = user_id
  and (
    exists (
      select 1 from public.entitlements e
      where e.user_id = (select auth.uid())
        and e.entitlement_code in ('rhythmcoach.pro', 'rhythmcoach.personal_library_cloud')
        and e.active
        and (e.valid_until is null or e.valid_until > now())
    )
    or exists (
      select 1 from public.membership_admins a
      where a.user_id = (select auth.uid())
        and a.active
        and a.role = 'owner'
    )
  )
);

drop policy if exists "Members insert own RhythmCoach materials" on public.rhythmcoach_personal_materials;
create policy "Members insert own RhythmCoach materials"
on public.rhythmcoach_personal_materials for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    exists (
      select 1 from public.entitlements e
      where e.user_id = (select auth.uid())
        and e.entitlement_code in ('rhythmcoach.pro', 'rhythmcoach.personal_library_cloud')
        and e.active
        and (e.valid_until is null or e.valid_until > now())
    )
    or exists (
      select 1 from public.membership_admins a
      where a.user_id = (select auth.uid())
        and a.active
        and a.role = 'owner'
    )
  )
);

drop policy if exists "Members update own RhythmCoach materials" on public.rhythmcoach_personal_materials;
create policy "Members update own RhythmCoach materials"
on public.rhythmcoach_personal_materials for update
to authenticated
using (
  (select auth.uid()) = user_id
  and (
    exists (
      select 1 from public.entitlements e
      where e.user_id = (select auth.uid())
        and e.entitlement_code in ('rhythmcoach.pro', 'rhythmcoach.personal_library_cloud')
        and e.active
        and (e.valid_until is null or e.valid_until > now())
    )
    or exists (
      select 1 from public.membership_admins a
      where a.user_id = (select auth.uid())
        and a.active
        and a.role = 'owner'
    )
  )
)
with check (
  (select auth.uid()) = user_id
  and (
    exists (
      select 1 from public.entitlements e
      where e.user_id = (select auth.uid())
        and e.entitlement_code in ('rhythmcoach.pro', 'rhythmcoach.personal_library_cloud')
        and e.active
        and (e.valid_until is null or e.valid_until > now())
    )
    or exists (
      select 1 from public.membership_admins a
      where a.user_id = (select auth.uid())
        and a.active
        and a.role = 'owner'
    )
  )
);

drop policy if exists "Members delete own RhythmCoach materials" on public.rhythmcoach_personal_materials;
create policy "Members delete own RhythmCoach materials"
on public.rhythmcoach_personal_materials for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and (
    exists (
      select 1 from public.entitlements e
      where e.user_id = (select auth.uid())
        and e.entitlement_code in ('rhythmcoach.pro', 'rhythmcoach.personal_library_cloud')
        and e.active
        and (e.valid_until is null or e.valid_until > now())
    )
    or exists (
      select 1 from public.membership_admins a
      where a.user_id = (select auth.uid())
        and a.active
        and a.role = 'owner'
    )
  )
);

insert into public.billing_product_entitlements (product_code, entitlement_code)
values ('rhythmcoach', 'rhythmcoach.personal_library_cloud')
on conflict do nothing;
