-- ============================================================================
-- RAB Mini — skema Supabase (instalasi baru)
--
-- Jalankan seluruh file ini sekali di Supabase Dashboard → SQL Editor untuk
-- project yang benar-benar baru. Untuk project yang sudah berjalan, gunakan
-- supabase/migrations/0002_auth_ownership.sql (menambahkan kepemilikan pada
-- tabel yang sudah ada tanpa menghapus data).
--
-- Skema ini memakai Supabase Auth: setiap proyek dimiliki satu pengguna, dan
-- dokumen/item mengikuti kepemilikan proyek induknya.
--
-- Kolom di sini harus cocok dengan tipe baris di `src/lib/supabase/data.ts`
-- (ProjectRow, RabDocumentRow, RabItemRow). Ubah keduanya bersamaan.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tabel
-- ----------------------------------------------------------------------------

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  client     text,
  location   text,
  date       date,
  status     text not null default 'planning'
             check (status in ('active', 'planning', 'completed', 'on-hold')),
  created_at timestamptz not null default now()
);

create table if not exists public.rab_documents (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title      text not null default 'Dokumen RAB',
  date       date,
  created_at timestamptz not null default now()
);

create table if not exists public.rab_items (
  id          uuid primary key default gen_random_uuid(),
  rab_id      uuid not null references public.rab_documents (id) on delete cascade,
  description text not null default '',
  volume      numeric(14, 3) not null default 1 check (volume >= 0),
  unit        text not null default 'm2',
  unit_price  numeric(16, 2) not null default 0 check (unit_price >= 0),
  -- Struktur hasil import Excel (nullable; dokumen lama tetap datar).
  group_name      text,
  subgroup_name   text,
  item_group_name text,
  sort_order      integer,
  created_at  timestamptz not null default now()
);

-- Katalog harga milik pengguna. Sengaja TIDAK berelasi ke rab_items: harga
-- disalin (snapshot) saat item dipakai, sehingga perubahan katalog tidak
-- mengubah dokumen RAB yang sudah dibuat.
create table if not exists public.price_catalog (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  category    text not null default 'Material',
  unit        text not null default 'm2',
  unit_price  numeric(16, 2) not null default 0 check (unit_price >= 0),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- AHSP: analisis harga satuan pekerjaan milik pengguna.
create table if not exists public.ahsp_analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  category    text not null default 'Lainnya',
  unit        text not null default 'm2',
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Komponen AHSP. catalog_item_id hanya referensi informatif: ON DELETE SET
-- NULL, sehingga menghapus item katalog tidak menghapus komponen (nama,
-- satuan, dan harga sudah disalin ke kolom komponen).
create table if not exists public.ahsp_components (
  id                uuid primary key default gen_random_uuid(),
  analysis_id       uuid not null references public.ahsp_analyses (id) on delete cascade,
  catalog_item_id   uuid references public.price_catalog (id) on delete set null,
  resource_name     text not null,
  resource_category text not null default 'Material',
  unit              text not null default 'm2',
  coefficient       numeric(18, 6) not null default 1 check (coefficient >= 0),
  unit_price        numeric(16, 2) not null default 0 check (unit_price >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Indeks
-- ----------------------------------------------------------------------------

create index if not exists projects_user_id_idx
  on public.projects (user_id);

create index if not exists rab_documents_project_id_idx
  on public.rab_documents (project_id);

create index if not exists rab_items_rab_id_created_at_idx
  on public.rab_items (rab_id, created_at, id);

create index if not exists rab_items_rab_sort_idx
  on public.rab_items (rab_id, sort_order);

create index if not exists price_catalog_user_name_idx
  on public.price_catalog (user_id, lower(name));

create index if not exists price_catalog_user_category_idx
  on public.price_catalog (user_id, category);

create index if not exists ahsp_analyses_user_name_idx
  on public.ahsp_analyses (user_id, lower(name));

create index if not exists ahsp_analyses_user_category_idx
  on public.ahsp_analyses (user_id, category);

create index if not exists ahsp_components_analysis_idx
  on public.ahsp_components (analysis_id, created_at, id);

create index if not exists ahsp_components_catalog_idx
  on public.ahsp_components (catalog_item_id);

-- ----------------------------------------------------------------------------
-- updated_at otomatis
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

drop trigger if exists ahsp_analyses_set_updated_at on public.ahsp_analyses;
create trigger ahsp_analyses_set_updated_at
  before update on public.ahsp_analyses
  for each row execute function public.set_updated_at();

drop trigger if exists ahsp_components_set_updated_at on public.ahsp_components;
create trigger ahsp_components_set_updated_at
  before update on public.ahsp_components
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — hanya pemilik data yang dapat mengaksesnya
-- ----------------------------------------------------------------------------

alter table public.projects      enable row level security;
alter table public.rab_documents enable row level security;
alter table public.rab_items     enable row level security;
alter table public.price_catalog enable row level security;
alter table public.ahsp_analyses   enable row level security;
alter table public.ahsp_components enable row level security;

drop policy if exists "dev full access" on public.projects;
drop policy if exists "dev full access" on public.rab_documents;
drop policy if exists "dev full access" on public.rab_items;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "rab_documents_select_own" on public.rab_documents;
create policy "rab_documents_select_own" on public.rab_documents
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_documents_insert_own" on public.rab_documents;
create policy "rab_documents_insert_own" on public.rab_documents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_documents_update_own" on public.rab_documents;
create policy "rab_documents_update_own" on public.rab_documents
  for update to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_documents_delete_own" on public.rab_documents;
create policy "rab_documents_delete_own" on public.rab_documents
  for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_items_select_own" on public.rab_items;
create policy "rab_items_select_own" on public.rab_items
  for select to authenticated
  using (
    exists (
      select 1 from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_items_insert_own" on public.rab_items;
create policy "rab_items_insert_own" on public.rab_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_items_update_own" on public.rab_items;
create policy "rab_items_update_own" on public.rab_items
  for update to authenticated
  using (
    exists (
      select 1 from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_items_delete_own" on public.rab_items;
create policy "rab_items_delete_own" on public.rab_items
  for delete to authenticated
  using (
    exists (
      select 1
      from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id and p.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- Katalog harga — hanya pemilik
-- ----------------------------------------------------------------------------

drop policy if exists "price_catalog_select_own" on public.price_catalog;
create policy "price_catalog_select_own" on public.price_catalog
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "price_catalog_insert_own" on public.price_catalog;
create policy "price_catalog_insert_own" on public.price_catalog
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "price_catalog_update_own" on public.price_catalog;
create policy "price_catalog_update_own" on public.price_catalog
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "price_catalog_delete_own" on public.price_catalog;
create policy "price_catalog_delete_own" on public.price_catalog
  for delete to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- AHSP — analisis milik pengguna, komponen mengikuti analisisnya
-- ----------------------------------------------------------------------------

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
-- Hak akses tabel
-- ----------------------------------------------------------------------------

revoke all on table public.price_catalog from anon;
revoke all on table public.ahsp_analyses from anon;
revoke all on table public.ahsp_components from anon;

grant select, insert, update, delete on table public.price_catalog   to authenticated;
grant select, insert, update, delete on table public.ahsp_analyses   to authenticated;
grant select, insert, update, delete on table public.ahsp_components to authenticated;

grant all on table public.price_catalog   to service_role;
grant all on table public.ahsp_analyses   to service_role;
grant all on table public.ahsp_components to service_role;
