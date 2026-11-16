# RAB Mini

**Versi rilis: v1.0.1.** Catatan rilis ada di
[`docs/release-v1.0.1.md`](docs/release-v1.0.1.md). Panduan backup, cleanup,
dan deployment database v1.0.0 tetap tersedia di
[`docs/release-v1.0.0.md`](docs/release-v1.0.0.md).

Aplikasi web untuk membantu kontraktor dan arsitek menyusun serta mengelola
**Rencana Anggaran Biaya (RAB)**.

Data proyek, dokumen RAB, dan item pekerjaan disimpan di **Supabase** (Postgres)
dan dilindungi per pengguna lewat **Supabase Auth + Row Level Security**. Setiap
pengguna hanya dapat melihat dan mengubah datanya sendiri.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack, Cache Components)
- TypeScript
- Tailwind CSS v4
- shadcn/ui-style components built on [Base UI](https://base-ui.com)
- Lucide Icons
- [Supabase](https://supabase.com) (`@supabase/supabase-js`) — Postgres, Auth, RLS

## Struktur folder

- `src/` — kode aplikasi (App Router, komponen, library).
- `src/assets/branding/` — sumber dan varian tampilan logo:
  - `rev/astaworks.png` — **sumber asli terbaru** (wordmark + tagline).
  - `rev/astaworks-arrow.png` — sumber arrow transparan.
  - `astaworks-full.png` / `astaworks-full-light.png` — untuk login/pratinjau.
  - `astaworks-wordmark.png` / `astaworks-wordmark-light.png` — untuk sidebar.
  - `astaworks-arrow.png` — area ringkas/mobile.
  Varian dibuat dengan `python scripts/make-logo-variants.py` (butuh Pillow,
  hanya untuk perawatan aset). File sumber di `rev/` tidak diubah.
- `public/` — aset publik statis.
- `scripts/` — smoke test Supabase dan utilitas QA:
  - `node scripts/run-qa.mjs scripts/smoke-crud.mjs` menjalankan skrip dan
    menyimpan log ke `artifacts/qa/logs/`.
  - `scripts/qa-paths.mjs` menyediakan helper path artefak.
- `artifacts/qa/screenshots/` — screenshot pengujian browser.
- `artifacts/qa/exports/` — workbook/PDF hasil pengujian.
- `artifacts/qa/logs/` — log pengujian.
- `supabase/` — skema dan migration SQL.
- `reference-files/` — berkas contoh untuk pengujian impor.

Isi `artifacts/qa/*` diabaikan Git (kecuali `.gitkeep`); aset di
`src/assets/branding` tetap terlacak.

## Mengganti logo

Sumber asli ada di `src/assets/branding/rev/` (`astaworks.png` dan
`astaworks-arrow.png`). Setelah mengganti berkas di sana, jalankan
`python scripts/make-logo-variants.py` untuk menghasilkan ulang varian full,
wordmark, dan arrow (versi gelap/terang) di `src/assets/branding/`. Restart dev
server dan hard-refresh halaman. Komponen
[`BrandMark`](src/components/layout/brand-mark.tsx) adalah satu-satunya tempat
import logo; tidak ada kotak putih, teks “RAB Mini”, atau `object-cover`.
Varian dipilih lewat `data-theme`, jadi tidak perlu filter/invert.

Favicon aplikasi memakai aset arrow yang sama:
`src/app/icon.png` (256×256, transparan) dan `src/app/favicon.ico` (16–256 px).
Favicon bawaan Next.js sudah dihapus, jadi tab browser menampilkan arrow
Astaworks. Jika masih terlihat ikon lama, lakukan hard refresh/incognito karena
browser menyimpan favicon di cache.

## Tema

Pilihan tema (Terang / Gelap / Ikuti sistem) tersimpan per perangkat di
`localStorage` kunci `rab-theme`, tersedia di menu ikon tema pada header dan
Settings. Skrip kecil di root layout menerapkan tema sebelum paint untuk
mencegah kilatan tema; palette Light Gray/navy dan aksen Royal Blue ada di
`src/app/globals.css`. PDF/Excel tetap memakai tampilan cetak terang dan tidak
terpengaruh tema aplikasi.

## Menyiapkan Supabase

1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**:
   - project baru → tempel dan jalankan [`supabase/schema.sql`](supabase/schema.sql);
   - project yang sudah memiliki tabel → jalankan migration secara berurutan:
     [`0002_auth_ownership.sql`](supabase/migrations/0002_auth_ownership.sql) →
     [`0003_price_catalog.sql`](supabase/migrations/0003_price_catalog.sql) →
     [`0004_ahsp.sql`](supabase/migrations/0004_ahsp.sql).
3. Salin **Project URL** dan **publishable key** dari
   *Project Settings → API Keys*, lalu isi `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   Hanya kunci publik yang dipakai — jangan pernah menaruh service role key di
   aplikasi ini.
4. Pastikan provider **Email** aktif di *Authentication → Providers*. Secara
   bawaan Supabase meminta konfirmasi email: setelah mendaftar, pengguna harus
   membuka tautan konfirmasi sebelum bisa masuk. Untuk pengujian cepat, matikan
   *Confirm email* di *Authentication → Sign In / Providers*, atau buat pengguna
   langsung dari *Authentication → Users* (sudah terkonfirmasi).

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

Buka http://localhost:3000 — halaman `/` mengarah ke `/dashboard`, dan pengguna
yang belum masuk akan dialihkan ke `/login`.

Perintah lain:

```bash
npm run build   # production build + type check
npm run start   # jalankan hasil build
npm run lint    # ESLint
```

## Autentikasi

| Halaman     | Isi                                                             |
| ----------- | --------------------------------------------------------------- |
| `/login`    | Masuk dengan email + password                                   |
| `/register` | Daftar akun baru (email, password, ulangi password)             |
| lainnya     | Dilindungi `AuthGate`; belum masuk → dialihkan ke `/login`       |

- **Sesi** disimpan `@supabase/supabase-js` di `localStorage` (kunci
  `rab-mini:auth`) dan diperbarui otomatis, jadi tetap aktif setelah refresh.
- **Keluar** ada di menu pengguna (kanan atas) → sesi dihapus, kembali ke
  `/login`.
- **Identitas** yang tampil di header diambil dari sesi (email pengguna), bukan
  data statis.
- **Batas keamanan sebenarnya adalah RLS**, bukan gerbang halaman. `AuthGate`
  hanya mengatur UX; tanpa sesi valid, semua query tetap ditolak Postgres.

### Kepemilikan data

```
auth.users ──1:1──▶ projects.user_id
                    └── rab_documents.project_id ──▶ rab_items.rab_id
```

- `projects.user_id` diisi otomatis dengan `auth.uid()` saat insert.
- Policy `SELECT/INSERT/UPDATE/DELETE` hanya berlaku untuk role `authenticated`
  dan mensyaratkan `user_id = auth.uid()`.
- `rab_documents` dan `rab_items` mewarisi kepemilikan lewat `exists (...)` ke
  proyek induknya, sehingga memindahkan dokumen ke proyek orang lain ditolak.
- Menghapus pengguna atau proyek menghapus turunannya lewat `on delete cascade`.
- Policy lama `dev full access` untuk `anon` dihapus oleh migration 0002.

## Halaman

| Route             | Isi                                                                     |
| ----------------- | ----------------------------------------------------------------------- |
| `/dashboard`      | Ringkasan KPI, proyek terbaru, dokumen terbaru, aksi cepat               |
| `/projects`       | Daftar proyek dengan pencarian, filter status, tampilan tabel/kartu      |
| `/projects/[id]`  | Detail proyek, daftar dokumen RAB, edit/hapus proyek                     |
| `/rab`            | Daftar dokumen RAB dengan pencarian dan menu aksi                        |
| `/rab/[id]`       | Editor RAB: judul, rincian pekerjaan, total otomatis, tombol Export PDF  |
| `/catalog`        | Katalog harga: material/pekerjaan, kategori, satuan, harga satuan       |
| `/ahsp`           | Analisis harga satuan pekerjaan: daftar analisis + pencarian/filter     |
| `/ahsp/[id]`      | Editor AHSP: komponen material/tenaga kerja/peralatan + total           |
| `/settings`       | Profil pengguna, identitas perusahaan (opsional), tema tampilan          |

## Katalog Harga

Menyimpan material dan pekerjaan beserta satuan dan harga satuannya, lalu
memakainya langsung di editor RAB.

- **Halaman** `/catalog`: daftar item, pencarian nama, filter kategori,
  tambah/edit/hapus (dengan konfirmasi), serta kondisi loading/error/kosong.
- **Kategori** bawaan: Material, Pekerjaan, Upah, Alat, Lainnya. Kategori
  disimpan sebagai teks, jadi menambah kategori cukup dengan menambah satu
  entri di `CATALOG_CATEGORIES` ([catalog.ts](src/lib/catalog.ts)) — tanpa
  migration baru. Kategori lain yang sudah ada di data ikut muncul di filter.
- **Dari editor RAB**: tombol "Pilih dari Katalog" (di bawah tabel maupun pada
  kondisi kosong) membuka dialog pencarian + filter; item terpilih langsung
  mengisi uraian, satuan, dan harga satuan, lalu pengguna mengisi volume
  seperti biasa. Menambah item manual tetap tersedia.
- **Snapshot harga (penting)**: `price_catalog` **tidak** berelasi ke
  `rab_items`. Saat dipilih, nama/satuan/harga **disalin** ke baris RAB. Jadi:
  mengubah harga katalog tidak mengubah RAB lama, menghapus item katalog tidak
  menghapus item RAB, dan harga di RAB tetap bisa diedit manual tanpa
  menyentuh katalog.
- **Kepemilikan**: `price_catalog.user_id` diisi otomatis `auth.uid()` dan RLS
  membatasi SELECT/INSERT/UPDATE/DELETE ke pemiliknya; role `anon` tidak
  diberi hak akses tabel.

## Excel Import & Export

Untuk pengguna yang biasa menyusun RAB di Excel.

**Export** (tombol "Export Excel" di header editor RAB):
- Berkas `.xlsx` berisi kop, identitas proyek (nama, klien, lokasi, nomor,
  tanggal), tabel No/Uraian/Volume/Satuan/Harga Satuan/Jumlah Harga, dan baris
  TOTAL.
- Nilai uang & volume ditulis sebagai **angka** (`t: "n"`), bukan teks, dan
  setiap baris memakai rumus `=Volume*Harga Satuan`; total memakai `SUM(...)`.
- Header berwarna, border, format ribuan, lebar kolom, dan judul ter-merge
  (memakai `xlsx-js-style`).
- Nama berkas: `RAB_<Nama_Proyek>_<Tahun>.xlsx`.
- RAB kosong tetap bisa diekspor (header + total 0).

**Import** (tombol "Import Excel" di halaman RAB):
1. Pilih proyek tujuan, berkas `.xlsx`/`.xls`, dan nama dokumen.
2. Pilih sheet, baris header, dan **pemetaan kolom** (dikenali otomatis dari
   variasi nama umum: Uraian/Nama Pekerjaan/Deskripsi, Volume/Qty/Kuantitas,
   Satuan/Unit, Harga Satuan/Harga, Jumlah Harga/Total) + pratinjau 5 baris.
3. Ringkasan validasi: baris ditemukan, valid, dilewati, bermasalah (dengan
   alasan per baris) dan catatan (mis. satuan tak dikenal).
4. Konfirmasi → dibuat **dokumen RAB baru** beserta itemnya; dokumen lama tidak
   pernah ditimpa. Bila penyimpanan item gagal di tengah jalan, dokumen yang
   baru dibuat dihapus kembali (tidak ada data parsial).

Aturan validasi ([excel-import.ts](src/lib/excel-import.ts)):
- Uraian kosong, volume/harga bukan angka valid → baris bermasalah (tidak diimpor).
- Baris kosong dan baris total/subtotal dilewati.
- Selisih subtotal file vs hitungan item ditampilkan sebagai peringatan.
- **Struktur dipertahankan**: baris judul diklasifikasikan GROUP → SUBGROUP →
  ITEM GROUP; item menyimpan `group_name`/`subgroup_name`/`item_group_name` +
  `sort_order` (nomor baris Excel). Baris subtotal/total tidak diimpor sebagai
  item. Klasifikasi mengikuti urutan baris, sehingga kode kelompok yang dipakai
  ulang (mis. `A` dua kali) tetap menjadi kelompok baru.
- **Koreksi sebelum impor**: judul tanpa item ditandai *ambigu* dan dapat
  diubah klasifikasinya (Group / Subgroup / Item group / Catatan) di langkah
  pratinjau; total dan struktur dihitung ulang saat koreksi.
- **Header**: mendukung header berspasi (`U R A I A N   P E K E R J A A N`) dan
  header dua baris (`Harga Sat` + `(Rp)`); pemetaan manual tetap tersedia.
- **Keterbatasan**: hidden rows/columns tidak dideteksi (library tidak
  mengekspos metadatanya); subjudul tambahan bertanda `-` tidak disimpan
  sebagai baris, tetapi item di bawahnya tetap masuk ke kelompoknya; baris
  dengan harga berupa teks (mis. "Supply by owner") dilaporkan sebagai baris
  bermasalah, bukan diimpor.
- Satuan kosong/tak dikenal → memakai `unit` dengan catatan.
- Angka format Indonesia (`1.500`, `2,5`) maupun internasional (`1,500`,
  `2.5`), termasuk awalan `Rp`, ditangani; negatif/NaN/Infinity ditolak.
- "Jumlah Harga" dihitung ulang dari volume × harga satuan.
- Batas: berkas 5 MB, 1.000 baris per import, sheet dibaca maksimal 5.000 baris.

## AHSP (Analisis Harga Satuan Pekerjaan)

Menyusun harga satuan pekerjaan dari komponen material, tenaga kerja, dan
peralatan. **Tidak ada koefisien atau harga bawaan** — seluruh angka diisi
pengguna; aplikasi tidak mengklaim angka sebagai standar resmi.

- **Halaman** `/ahsp`: daftar analisis, pencarian nama pekerjaan, filter
  kategori (Persiapan … Lainnya), tambah/edit/hapus dengan konfirmasi.
- **Editor** `/ahsp/[id]`: informasi pekerjaan (nama, kategori, satuan,
  deskripsi) + komponen per kelompok dengan subtotal tiap kelompok dan total.
- **Rumus** ([ahsp.ts](src/lib/ahsp.ts)): `Jumlah biaya = koefisien × harga
  dasar`; `Total = Σ jumlah biaya`. Perhitungan memakai bilangan bulat (koefisien
  dalam mikro ×1e6, harga dalam sen ×100) sehingga tidak ada galat floating
  point; total = penjumlahan sen yang eksak.
- **Dari katalog**: tombol "Pilih dari Katalog" mengisi nama, satuan, dan harga
  dasar sebagai *snapshot*; koefisien tetap diisi pengguna. Komponen manual
  selalu tersedia.
- **Snapshot**: `ahsp_components.catalog_item_id` hanyalah referensi informatif
  dengan `on delete set null` — menghapus item katalog tidak menghapus komponen,
  dan perubahan harga katalog tidak mengubah analisis.
- **Ke RAB**: di editor RAB tersedia "Pilih dari AHSP"; harga satuan = total
  analisis saat dipilih, lalu disalin ke `rab_items`. Perubahan analisis
  berikutnya tidak mengubah item RAB tersebut.
- **Kepemilikan**: `ahsp_analyses.user_id` diisi otomatis `auth.uid()`; komponen
  mengikuti kepemilikan analisisnya lewat `EXISTS`. Role `anon` tidak diberi hak
  akses tabel.

## Ekspor PDF

Dari editor RAB atau menu aksi pada daftar RAB, dokumen dapat diunduh sebagai
PDF A4 siap cetak.

- **Library:** [`jspdf`](https://github.com/parallax/jsPDF) +
  [`jspdf-autotable`](https://github.com/simonbengtsson/jsPDF-AutoTable), dimuat
  dinamis (`import()`) sehingga tidak masuk ke bundel utama.
- **Isi dokumen:** kop identitas perusahaan (opsional; baris nama/kontak yang
  kosong tidak dicetak), judul "RENCANA ANGGARAN BIAYA", nama proyek,
  klien, lokasi, nomor & tanggal dokumen, tabel item (No., Uraian, Volume,
  Satuan, Harga Satuan, Jumlah Harga), rekapitulasi total, dan blok tanda
  tangan tiga kolom.
- **Perhitungan** memakai fungsi yang sama dengan UI (`calculateItemAmount`,
  `calculateRabTotal`), jadi angka PDF identik dengan yang tampil di aplikasi.
- **Nama berkas:** `RAB_<Nama_Proyek>_<Tahun>.pdf`.
- **Tata letak:** header tabel berulang di setiap halaman, baris tidak dipotong
  (`rowPageBreak: "avoid"`), rekap + tanda tangan dijaga agar tidak terpisah,
  serta footer "Halaman X dari Y".
- **Batas panjang:** uraian > 900 karakter dan nama proyek/klien/lokasi > 160
  karakter dipotong dengan elipsis agar tidak meluber keluar halaman; data
  aslinya tidak berubah di database.
- **Angka:** format Indonesia (pemisah ribuan titik, desimal koma). Nilai uang
  menampilkan sen hanya bila hasil kali volume × harga memang pecahan, sehingga
  jumlah baris selalu sama dengan total yang tercetak.
- **Data & keamanan:** PDF dibuat dari data yang sudah dimuat lewat RLS, tanpa
  query tambahan dan tanpa service role key.

## Struktur folder

```
src/
├── app/                     # Route App Router (satu layout per halaman)
│   ├── login/               # Halaman masuk
│   ├── register/            # Halaman daftar
│   ├── dashboard/
│   ├── projects/
│   ├── rab/
│   ├── settings/
│   ├── globals.css          # Design tokens & base styles
│   └── layout.tsx           # Root layout: font, ThemeProvider, AuthProvider, DataProvider, toaster
├── components/
│   ├── auth/                # AuthGate, AuthForm
│   ├── ahsp/                # AhspView, AhspEditor, AhspFormDialog, AhspComponentDialog
│   ├── catalog/             # CatalogView, CatalogFormDialog
│   ├── layout/              # AppShell, ProtectedShell, AppSidebar, AppHeader, ThemeMenu, Logo, BrandMark
│   ├── providers/           # ThemeProvider, AuthProvider (sesi), DataProvider (data + sinkronisasi)
│   ├── shared/              # PageHeader, StatCard, StatusBadge, EmptyState, DataError, …
│   ├── projects/            # ProjectTable, ProjectCard, ProjectsView, ProjectFormDialog
│   ├── rab/                 # RabTable, RabView, RabDocumentDialog, ExportRabButton, ExportExcelButton, CatalogPickerDialog, AhspPickerDialog, ImportExcelDialog
│   │   └── editor/          # RabEditor, DocumentHeader, WorkItemsTable, RabSummary
│   ├── settings/            # SettingsView
│   ├── dashboard/           # DashboardView, MigrationBanner, TodayLabel
│   └── ui/                  # Primitives ala shadcn/ui (Button, Card, Dialog, Select, …)
├── hooks/                   # useNow, use-rab-pdf-export, use-catalog, use-ahsp
├── lib/
│   ├── auth/messages.ts     # Terjemahan pesan error Supabase Auth
│   ├── supabase/
│   │   ├── client.ts        # Klien browser (sesi persisten, publishable key saja)
│   │   ├── data.ts          # Query + CRUD + pemetaan baris → tipe domain
│   │   ├── catalog.ts       # CRUD katalog harga (price_catalog)
│   │   ├── ahsp.ts          # CRUD analisis + komponen AHSP
│   │   └── migrate.ts       # Migrasi snapshot localStorage lama → Supabase
│   ├── rab-pdf.ts           # Penyusun dokumen PDF RAB (A4, jsPDF + autotable)
│   ├── rab-excel.ts         # Ekspor RAB ke .xlsx (xlsx-js-style)
│   ├── excel-import.ts      # Baca berkas, deteksi header, pemetaan kolom, validasi
│   ├── catalog.ts           # Konstanta & helper katalog (filter, kategori, snapshot)
│   ├── ahsp.ts              # Konstanta, rumus AHSP (bilangan bulat), filter, snapshot
│   ├── legacy-migration.ts  # Pembacaan snapshot localStorage lama (read-only)
│   ├── rab-calc.ts          # Perhitungan RAB & parsing angka (pure)
│   ├── status.ts            # Status proyek + metadata tampilan
│   ├── profile.ts           # Default + resolver identitas pengguna/perusahaan
│   ├── format.ts            # Format IDR, tanggal, waktu relatif
│   ├── navigation.ts        # Konfigurasi menu sidebar
│   └── utils.ts             # cn() helper
└── types/                   # Tipe domain (Project, RabDocument, RabWorkItem)

supabase/
├── schema.sql               # Skema lengkap untuk project baru (termasuk RLS)
└── migrations/
    ├── 0002_auth_ownership.sql   # Kepemilikan + RLS untuk project yang sudah ada
    ├── 0003_price_catalog.sql    # Tabel katalog harga + RLS
    ├── 0004_ahsp.sql             # Tabel AHSP (analisis + komponen) + RLS
    └── 0005_rab_item_structure.sql  # Kolom hierarki item RAB (hasil import Excel)

scripts/
├── smoke-crud.mjs           # Uji CRUD end-to-end (butuh akun terkonfirmasi bila RLS aktif)
├── smoke-auth-rls.mjs       # Uji isolasi data antar pengguna
├── smoke-catalog.mjs        # Uji CRUD katalog, isolasi, dan snapshot harga
├── smoke-ahsp.mjs           # Uji CRUD AHSP, isolasi, snapshot katalog & RAB
└── smoke-import.mjs         # Uji jalur DB import Excel (dokumen baru, batch, RLS)
```

## Alur data

- `AuthProvider` memulihkan sesi lebih dulu; `DataProvider` hanya memuat data
  setelah ada sesi, dan mengosongkan state saat sesi berakhir.
- Seluruh workspace dimuat sekali lewat tiga query paralel (`projects`,
  `rab_documents`, `rab_items`); RLS memfilter hasilnya sesuai pemilik.
- Nilai turunan — jumlah item, total per dokumen, total per proyek — selalu
  dihitung ulang dari data mentah (`recomputeWorkspace`).
- Edit volume/harga memakai *optimistic update* dengan debounce 500 ms per baris,
  dan tetap dikirim saat halaman disembunyikan/ditinggalkan agar perubahan
  terakhir tidak hilang.
- Menghapus proyek menghapus dokumen dan itemnya lewat `on delete cascade`.

## Menguji

```bash
npm run build                      # typecheck penuh
npm run lint                       # ESLint
node scripts/smoke-crud.mjs        # CRUD end-to-end
node scripts/smoke-auth-rls.mjs    # isolasi data antar pengguna
node scripts/smoke-catalog.mjs     # CRUD katalog + isolasi + snapshot harga
node scripts/smoke-ahsp.mjs        # CRUD AHSP + isolasi + snapshot katalog/RAB
node scripts/smoke-import.mjs      # jalur DB import Excel (dokumen baru + RLS)
```

Setelah RLS aktif, `smoke-crud.mjs` juga memerlukan sesi terkonfirmasi:

```powershell
$env:RLS_EMAIL_A="a@contoh.com"; $env:RLS_PASSWORD_A="rahasia1"
node scripts/smoke-crud.mjs
```

`smoke-auth-rls.mjs` memerlukan **dua** akun terkonfirmasi:

```powershell
$env:RLS_EMAIL_A="a@contoh.com"; $env:RLS_PASSWORD_A="rahasia1"
$env:RLS_EMAIL_B="b@contoh.com"; $env:RLS_PASSWORD_B="rahasia2"
node scripts/smoke-auth-rls.mjs
```

## Catatan implementasi

- **Design tokens** ada di `@theme` pada `src/app/globals.css`. Warna baru
  sebaiknya memakai token yang sudah ada agar tampilan tetap konsisten.
- **Cache Components** aktif (bawaan Next.js 16). Hindari `new Date()` saat
  render server; gunakan hook `useNow()` untuk waktu relatif.
- **Metadata halaman detail** bersifat statis karena judul proyek/dokumen hanya
  diketahui klien setelah data dimuat.
- **Ekspor Excel** tersedia dari editor/daftar RAB; PDF dan Excel memakai
  perhitungan yang sama.
- **Profil pengguna dan identitas perusahaan** disimpan di `user_metadata`
  Supabase Auth (`full_name`, `company`); tidak ada tabel profil terpisah.
  Identitas perusahaan bersifat opsional dan default-nya kosong, jadi aplikasi
  tidak pernah menampilkan contoh perusahaan sebagai data pengguna.
- **Data lama tanpa pemilik** (`user_id IS NULL`) tidak terlihat oleh pengguna
  mana pun setelah migration 0002. File migration memuat perintah opsional
  (dikomentari) untuk menghapus atau mengklaimnya.
