-- ============================================================================
-- RAB Mini v1.0.0 — bersihkan data bisnis (SEMUA AKUN)
--
-- JALANKAN HANYA SETELAH:
--   1. Backup lokal berhasil: node scripts/release/backup-v1.0.0.mjs
--   2. Target project sudah dipastikan benar.
--
-- Yang dihapus: projects, rab_documents, rab_items, price_catalog,
-- ahsp_analyses, ahsp_components.
-- Yang dipertahankan: auth.users, user_metadata (profil/perusahaan), skema,
-- RLS, index, fungsi, dan konfigurasi database.
--
-- Jalankan sebagai owner project (SQL Editor) atau service role. Jalankan
-- seluruh file dalam satu transaksi; blok DO akan membatalkan commit jika ada
-- baris tersisa.
-- ============================================================================

begin;

-- Cegah penulisan bisnis selama cleanup singkat ini.
lock table
  public.rab_items,
  public.rab_documents,
  public.projects,
  public.ahsp_components,
  public.ahsp_analyses,
  public.price_catalog
in access exclusive mode;

delete from public.rab_items;
delete from public.rab_documents;
delete from public.projects;
delete from public.ahsp_components;
delete from public.ahsp_analyses;
delete from public.price_catalog;

do $$
declare
  n bigint;
begin
  select count(*) into n from public.projects;
  if n <> 0 then raise exception 'projects masih % baris', n; end if;

  select count(*) into n from public.rab_documents;
  if n <> 0 then raise exception 'rab_documents masih % baris', n; end if;

  select count(*) into n from public.rab_items;
  if n <> 0 then raise exception 'rab_items masih % baris', n; end if;

  select count(*) into n from public.price_catalog;
  if n <> 0 then raise exception 'price_catalog masih % baris', n; end if;

  select count(*) into n from public.ahsp_analyses;
  if n <> 0 then raise exception 'ahsp_analyses masih % baris', n; end if;

  select count(*) into n from public.ahsp_components;
  if n <> 0 then raise exception 'ahsp_components masih % baris', n; end if;
end $$;

commit;

-- Verifikasi pasca-cleanup (harus semua 0):
-- select 'projects' as tabel, count(*) from public.projects
-- union all select 'rab_documents', count(*) from public.rab_documents
-- union all select 'rab_items', count(*) from public.rab_items
-- union all select 'price_catalog', count(*) from public.price_catalog
-- union all select 'ahsp_analyses', count(*) from public.ahsp_analyses
-- union all select 'ahsp_components', count(*) from public.ahsp_components;
