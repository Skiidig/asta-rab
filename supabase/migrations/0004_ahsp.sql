-- ============================================================================
-- 0004 — AHSP (Analisis Harga Satuan Pekerjaan)
--
-- Jalankan di Supabase Dashboard → SQL Editor SETELAH
-- 0002_auth_ownership.sql dan 0003_price_catalog.sql.
-- Aman dijalankan ulang (idempotent).
--
-- Ringkasan:
--   1. public.ahsp_analyses  — satu baris per analisis pekerjaan, milik user.
--   2. public.ahsp_components — komponen material/tenaga kerja/peralatan.
--   3. catalog_item_id opsional dengan ON DELETE SET NULL: menghapus item
--      katalog TIDAK menghapus komponen, karena nama/satuan/harga sudah
--      disalin (snapshot) ke kolom komponen.
--   4. updated_at dijaga trigger.
--   5. RLS: analisis hanya milik pemiliknya; komponen mengikuti analisisnya.
--
-- Catatan: tidak ada koefisien AHSP bawaan. Semua koefisien dan harga diisi
-- pengguna; aplikasi tidak menyediakan angka standar apa pun.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Prasyarat: tabel katalog harga (0003).
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'price_catalog'
  ) then
    raise exception
      'Tabel public.price_catalog belum ada. Jalankan supabase/migrations/0003_price_catalog.sql lebih dulu.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Tabel
-- ----------------------------------------------------------------------------

create table if not exists public.ahsp_analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  -- Kategori pekerjaan disimpan sebagai teks bebas agar daftar kategori dapat
  -- dikembangkan tanpa migration baru.
  category    text not null default 'Lainnya',
  unit        text not null default 'm2',
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ahsp_components (
  id                uuid primary key default gen_random_uuid(),
  analysis_id       uuid not null references public.ahsp_analyses (id) on delete cascade,
  -- Referensi informatif saja. ON DELETE SET NULL + snapshot kolom di bawah
  -- memastikan komponen tetap utuh walau item katalog dihapus.
  catalog_item_id   uuid references public.price_catalog (id) on delete set null,
  resource_name     text not null,
  resource_category text not null default 'Material',
  unit              text not null default 'm2',
  -- Koefisien: 6 angka desimal (0,000001 - 999.999.999.999,999999).
  coefficient       numeric(18, 6) not null default 1 check (coefficient >= 0),
  unit_price        numeric(16, 2) not null default 0 check (unit_price >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Indeks
-- ----------------------------------------------------------------------------

create index if not exists ahsp_analyses_user_name_idx
  on public.ahsp_analyses (user_id, lower(name));

create index if not exists ahsp_analyses_user_category_idx
  on public.ahsp_analyses (user_id, category);

create index if not exists ahsp_components_analysis_idx
  on public.ahsp_components (analysis_id, created_at, id);

create index if not exists ahsp_components_catalog_idx
  on public.ahsp_components (catalog_item_id);

-- ----------------------------------------------------------------------------
-- 3. updated_at otomatis
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ahsp_analyses_set_updated_at on public.ahsp_analyses;
create trigger ahsp_analyses_set_updated_at
  before update on public.ahsp_analyses
  for each row execute function public.set_updated_at();

drop trigger if exists ahsp_components_set_updated_at on public.ahsp_components;
create trigger ahsp_components_set_updated_at
  before update on public.ahsp_components
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.ahsp_analyses   enable row level security;
alter table public.ahsp_components enable row level security;

drop policy if exists "ahsp_analyses_select_own" on public.ahsp_analyses;
create policy "ahsp_analyses_select_own" on public.ahsp_analyses
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "ahsp_analyses_insert_own" on public.ahsp_analyses;
create policy "ahsp_analyses_insert_own" on public.ahsp_analyses
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "ahsp_analyses_update_own" on public.ahsp_analyses;
create policy "ahsp_analyses_update_own" on public.ahsp_analyses
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "ahsp_analyses_delete_own" on public.ahsp_analyses;
create policy "ahsp_analyses_delete_own" on public.ahsp_analyses
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "ahsp_components_select_own" on public.ahsp_components;
create policy "ahsp_components_select_own" on public.ahsp_components
  for select to authenticated
  using (
    exists (
      select 1 from public.ahsp_analyses a
      where a.id = ahsp_components.analysis_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "ahsp_components_insert_own" on public.ahsp_components;
create policy "ahsp_components_insert_own" on public.ahsp_components
  for insert to authenticated
  with check (
    exists (
      select 1 from public.ahsp_analyses a
      where a.id = ahsp_components.analysis_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "ahsp_components_update_own" on public.ahsp_components;
create policy "ahsp_components_update_own" on public.ahsp_components
  for update to authenticated
  using (
    exists (
      select 1 from public.ahsp_analyses a
      where a.id = ahsp_components.analysis_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.ahsp_analyses a
      where a.id = ahsp_components.analysis_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "ahsp_components_delete_own" on public.ahsp_components;
create policy "ahsp_components_delete_own" on public.ahsp_components
  for delete to authenticated
  using (
    exists (
      select 1 from public.ahsp_analyses a
      where a.id = ahsp_components.analysis_id and a.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Hak akses tabel
-- ----------------------------------------------------------------------------

revoke all on table public.ahsp_analyses   from anon;
revoke all on table public.ahsp_components from anon;

grant select, insert, update, delete on table public.ahsp_analyses   to authenticated;
grant select, insert, update, delete on table public.ahsp_components to authenticated;

grant all on table public.ahsp_analyses   to service_role;
grant all on table public.ahsp_components to service_role;
