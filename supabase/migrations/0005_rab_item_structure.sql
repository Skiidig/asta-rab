-- ============================================================================
-- 0005 — Struktur pekerjaan pada item RAB
--
-- Jalankan di Supabase Dashboard → SQL Editor setelah 0004_ahsp.sql.
-- Aman dijalankan ulang (idempotent).
--
-- Menambah konteks hierarki hasil import Excel. Semua kolom NULLABLE sehingga:
--   * dokumen RAB lama tetap valid dan tampil datar seperti sebelumnya;
--   * tidak ada backfill atau perubahan data yang sudah ada;
--   * policy RLS tidak berubah (masih berbasis rab_id → kepemilikan dokumen).
--
-- Baris judul kelompok TIDAK disimpan sebagai item biaya; nama kelompok
-- disimpan sebagai atribut pada setiap item, dan subtotal dihitung dari item.
-- ============================================================================

alter table public.rab_items
  add column if not exists group_name      text,
  add column if not exists subgroup_name   text,
  add column if not exists item_group_name text,
  add column if not exists sort_order      integer;

-- Urutan baca: sort_order (hasil import), lalu created_at untuk dokumen lama.
create index if not exists rab_items_rab_sort_idx
  on public.rab_items (rab_id, sort_order);

comment on column public.rab_items.group_name is
  'Nama kelompok pekerjaan (mis. "I BUILDING") — hasil import Excel; NULL untuk item manual/lama';
comment on column public.rab_items.subgroup_name is
  'Nama subkelompok (mis. "A. PRELIMINARY")';
comment on column public.rab_items.item_group_name is
  'Judul kelompok item (mis. "Pek. Ring Balok RB1 (200 x 350 mm)")';
comment on column public.rab_items.sort_order is
  'Urutan sumber (nomor baris Excel). NULL untuk item manual/lama';
