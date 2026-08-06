alter table public.product_feedback
  add column if not exists admin_note text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

comment on column public.product_feedback.admin_note is 'Private operator note. Never exposed through the public Account Shell.';
comment on column public.product_feedback.reviewed_at is 'Last time an administrator changed the feedback workflow state or note.';
comment on column public.product_feedback.reviewed_by is 'Administrator who most recently reviewed this feedback.';

alter table public.product_feedback
  drop constraint if exists product_feedback_admin_note_length;
alter table public.product_feedback
  add constraint product_feedback_admin_note_length
  check (admin_note is null or char_length(admin_note) <= 2000);

create index if not exists product_feedback_status_created_idx
  on public.product_feedback (status, created_at desc);
create index if not exists product_feedback_product_status_created_idx
  on public.product_feedback (product_code, status, created_at desc);
create index if not exists product_feedback_reviewed_by_idx
  on public.product_feedback (reviewed_by)
  where reviewed_by is not null;

drop trigger if exists product_feedback_set_updated_at on public.product_feedback;
create trigger product_feedback_set_updated_at
  before update on public.product_feedback
  for each row execute function public.set_updated_at();
