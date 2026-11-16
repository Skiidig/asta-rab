-- ============================================================================
-- 0002 — Kepemilikan data per pengguna (Supabase Auth)
--
-- Jalankan SELURUH file ini sekali di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang (idempotent), tetapi policy `dev full access` akan
-- dihapus sehingga akses anon berhenti — pastikan aplikasi versi baru
-- (dengan halaman login) sudah terpasang sebelum menjalankannya.
--
-- Ringkasan perubahan:
--   1. public.projects mendapat kolom `user_id` → auth.users(id).
--   2. `user_id` otomatis diisi auth.uid() saat insert.
--   3. Policy permisif untuk anon dihapus.
--   4. Policy SELECT/INSERT/UPDATE/DELETE dibuat untuk role `authenticated`,
--      dengan kepemilikan berantai: projects → rab_documents → rab_items.
--
-- Data lama tanpa pemilik TIDAK dihapus. Baris dengan user_id NULL menjadi
-- tidak terlihat oleh siapa pun karena policy mensyaratkan user_id = auth.uid().
-- Lihat bagian "Data lama" di akhir file untuk opsi lanjutan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Kolom kepemilikan
-- ----------------------------------------------------------------------------

alter table public.projects
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Baris baru otomatis menjadi milik pengguna yang sedang masuk.
alter table public.projects
  alter column user_id set default auth.uid();

create index if not exists projects_user_id_idx on public.projects (user_id);

-- ----------------------------------------------------------------------------
-- 2. Hapus policy development yang permisif
-- ----------------------------------------------------------------------------

drop policy if exists "dev full access" on public.projects;
drop policy if exists "dev full access" on public.rab_documents;
drop policy if exists "dev full access" on public.rab_items;

-- ----------------------------------------------------------------------------
-- 3. projects — pemilik penuh atas proyeknya sendiri
-- ----------------------------------------------------------------------------

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. rab_documents — kepemilikan mengikuti proyek induk
-- ----------------------------------------------------------------------------

drop policy if exists "rab_documents_select_own" on public.rab_documents;
create policy "rab_documents_select_own" on public.rab_documents
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_documents_insert_own" on public.rab_documents;
create policy "rab_documents_insert_own" on public.rab_documents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_documents_update_own" on public.rab_documents;
create policy "rab_documents_update_own" on public.rab_documents
  for update to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_documents_delete_own" on public.rab_documents;
create policy "rab_documents_delete_own" on public.rab_documents
  for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = rab_documents.project_id
        and p.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5. rab_items — kepemilikan mengikuti dokumen dan proyek induk
-- ----------------------------------------------------------------------------

drop policy if exists "rab_items_select_own" on public.rab_items;
create policy "rab_items_select_own" on public.rab_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_items_insert_own" on public.rab_items;
create policy "rab_items_insert_own" on public.rab_items
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "rab_items_update_own" on public.rab_items;
create policy "rab_items_update_own" on public.rab_items
  for update to authenticated
  using (
    exists (
      select 1
      from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.rab_documents d
      join public.projects p on p.id = d.project_id
      where d.id = rab_items.rab_id
        and p.user_id = auth.uid()
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
      where d.id = rab_items.rab_id
        and p.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Data lama tanpa pemilik
--
-- Setelah file ini dijalankan, baris proyek dengan user_id NULL tidak terlihat
-- oleh pengguna mana pun (aman, tidak merusak apa pun). Data tersebut adalah
-- data dummy/testing, jadi dua opsi berikut tersedia — keduanya DESTRUKTIF atau
-- mengubah kepemilikan, jadi jalankan hanya setelah disetujui:
--
--   a) Hapus proyek lama tanpa pemilik (dokumen & item ikut terhapus karena
--      foreign key on delete cascade):
--
--      delete from public.projects where user_id is null;
--
--   b) ATAU jadikan proyek lama milik akun tertentu (ganti dengan UUID dari
--      Authentication → Users):
--
--      update public.projects
--         set user_id = '00000000-0000-0000-0000-000000000000'
--       where user_id is null;
--
-- Periksa dulu isinya:
--
--   select id, name, created_at from public.projects where user_id is null;
-- ----------------------------------------------------------------------------
