-- جدول الأشهر: صف واحد لكل شهر لكل مستخدم
create table if not exists public.months (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year        int  not null check (year between 2000 and 2100),
  month       int  not null check (month between 1 and 12),
  salary      numeric(14,2) not null default 0 check (salary >= 0),
  expenses    jsonb not null default '[]'::jsonb,   -- [{ "name": "طعام", "amount": 500 }, ...]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, year, month)
);

create index if not exists months_user_idx on public.months (user_id, year, month);

-- تحديث updated_at تلقائياً
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists months_set_updated_at on public.months;
create trigger months_set_updated_at before update on public.months
for each row execute function public.set_updated_at();

-- أمان على مستوى الصفوف: كل مستخدم يرى بياناته فقط
alter table public.months enable row level security;

drop policy if exists "months_select_own" on public.months;
drop policy if exists "months_insert_own" on public.months;
drop policy if exists "months_update_own" on public.months;
drop policy if exists "months_delete_own" on public.months;

create policy "months_select_own" on public.months
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "months_insert_own" on public.months
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "months_update_own" on public.months
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "months_delete_own" on public.months
  for delete to authenticated using ((select auth.uid()) = user_id);
