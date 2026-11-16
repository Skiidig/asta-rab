-- ============================================================================
-- 0003 — Katalog Harga (material & pekerjaan) per pengguna
--
-- Jalankan seluruh file ini di Supabase Dashboard → SQL Editor SETELAH
-- 0002_auth_ownership.sql. Aman dijalankan ulang (idempotent).
--
-- Ringkasan:
--   1. Tabel public.price_catalog dengan kepemilikan user_id → auth.users.
--   2. `updated_at` dijaga trigger setiap kali baris diubah.
--   3. RLS: hanya pemilik yang dapat SELECT/INSERT/UPDATE/DELETE.
--   4. Grant eksplisit hanya untuk `authenticated` (bukan `anon`).
--
-- Catatan penting (snapshot harga):
--   Tabel ini SENGAJA tidak dihubungkan ke rab_items. Saat item katalog dipakai
--   di RAB, deskripsi/satuan/harga disalin ke baris rab_items. Dengan begitu
--   mengubah atau menghapus item katalog tidak pernah mengubah dokumen RAB
--   yang sudah dibuat.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Tabel
-- ----------------------------------------------------------------------------

create table if not exists public.price_catalog (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  -- Kategori disimpan sebagai teks bebas agar daftar kategori bisa
  -- dikembangkan tanpa migration baru.
  category    text not null default 'Material',
  unit        text not null default 'm2',
  unit_price  numeric(16, 2) not null default 0 check (unit_price >= 0),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Indeks
-- ----------------------------------------------------------------------------

create index if not exists price_catalog_user_name_idx
  on public.price_catalog (user_id, lower(name));

create index if not exists price_catalog_user_category_idx
  on public.price_catalog (user_id, category);

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

drop trigger if exists price_catalog_set_updated_at on public.price_catalog;
create trigger price_catalog_set_updated_at
  before update on public.price_catalog
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Row Level Security — hanya pemilik data
-- ----------------------------------------------------------------------------

alter table public.price_catalog enable row level security;

drop policy if exists "price_catalog_select_own" on public.price_catalog;
create policy "price_catalog_select_own" on public.price_catalog
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "price_catalog_insert_own" on public.price_catalog;
create policy "price_catalog_insert_own" on public.price_catalog
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "price_catalog_update_own" on public.price_catalog;
create policy "price_catalog_update_own" on public.price_catalog
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "price_catalog_delete_own" on public.price_catalog;
create policy "price_catalog_delete_own" on public.price_catalog
  for delete to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 5. Hak akses tabel
-- ----------------------------------------------------------------------------

revoke all on table public.price_catalog from anon;
grant select, insert, update, delete on table public.price_catalog to authenticated;
grant all on table public.price_catalog to service_role;
