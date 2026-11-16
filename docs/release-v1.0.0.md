# Rilis v1.0.0 — Backup, Cleanup, dan Deployment

Dokumen ini adalah panduan operator. Jangan menyimpan service role key,
password, atau isi `.env.local` di dokumen ini, Git, atau screenshot.

## 1. Target database

Aplikasi membaca hanya dua variabel publik dari `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Sebelum cleanup, cocokkan host URL dengan project Supabase yang dituju
(Supabase Dashboard → Project Settings → API). Jangan menjalankan cleanup pada
project lain.

Service role key **hanya** dipakai oleh skrip lokal di `scripts/release/` dan
tidak boleh memakai awalan `NEXT_PUBLIC_` atau masuk bundle browser.

## 2. Backup

Jalankan dari akar proyek dengan service role key di environment shell
(bukan file yang di-commit).

PowerShell (Windows):

```powershell
$env:RELEASE_SUPABASE_URL="https://<project-ref>.supabase.co"
$env:RELEASE_SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
node scripts/release/backup-v1.0.0.mjs
Remove-Item Env:RELEASE_SUPABASE_SERVICE_ROLE_KEY
```

Bash/macOS/Linux:

```bash
RELEASE_SUPABASE_URL="https://<project-ref>.supabase.co" \
RELEASE_SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
node scripts/release/backup-v1.0.0.mjs
```

Skrip:

- membaca **exact count** tiap tabel;
- mem-paginate dengan `order by id` (stabil, 1.000 baris per halaman);
- memeriksa ID duplikat dan kelengkapan enam tabel;
- membandingkan jumlah terkumpul dengan count;
- keluar non-zero dan **tidak** menulis laporan sukses jika ada kegagalan.

Hasil: `artifacts/release/backup-v1.0.0-<timestamp>.json`. Folder
`artifacts/release/` diabaikan Git. Backup berisi enam tabel bisnis dan tidak
berisi akun auth maupun kredensial.

**Jangan ada perubahan data selama backup → cleanup.** Hentikan penulisan
aplikasi (maintenance/read-only), jalankan backup, lalu segera jalankan cleanup
di jendela yang sama. Backup dan cleanup harus menunjuk host project yang sama.

## 3. Cleanup

1. Pastikan backup selesai.
2. Buka Supabase SQL Editor untuk project yang benar.
3. Jalankan seluruh `scripts/release/cleanup-v1.0.0.sql` dalam satu transaksi.
   Skrip mengunci tabel bisnis, menghapus anak → induk, dan membatalkan commit
   bila masih ada baris tersisa.

Yang dihapus:

- `rab_items`
- `rab_documents`
- `projects`
- `ahsp_components`
- `ahsp_analyses`
- `price_catalog`

Yang dipertahankan: `auth.users`, `user_metadata` (profil/identitas
perusahaan), skema, migrasi, RLS, index, fungsi, dan konfigurasi database.

Verifikasi dengan service role:

```bash
RELEASE_SUPABASE_URL=... RELEASE_SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/release/verify-empty-v1.0.0.mjs
```

Semua tabel harus bernilai `0`. Count `null`/tidak valid dianggap **gagal**,
bukan nol; skrip keluar non-zero.

## 4. Restore

```bash
RELEASE_SUPABASE_URL=... RELEASE_SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/release/restore-v1.0.0.mjs artifacts/release/backup-v1.0.0-<timestamp>.json
```

Sebelum menulis apa pun, skrip memvalidasi:

- versi backup (`1.0.0`);
- keberadaan **keenam** tabel (tabel yang hilang ditolak, bukan dianggap kosong);
- setiap baris memiliki `id`, tanpa duplikat;
- `counts` (bila ada) cocok dengan jumlah baris;
- `projectHost` backup sama dengan target `RELEASE_SUPABASE_URL`.

Target berbeda ditolak sebelum koneksi/penulisan. Urutan restore:
`projects` → `rab_documents` → `rab_items` → `price_catalog` →
`ahsp_analyses` → `ahsp_components`. Akun auth tidak diubah; pastikan UUID
pemilik masih ada di project tujuan.

## 5. Deployment

Prasyarat: Node.js 20+, project Supabase, dan akses ke dashboard hosting.
Tidak ada dependency atau konfigurasi output khusus.

### Environment produksi

Isi variabel berikut pada hosting:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

Jangan mengisi service role key pada environment hosting aplikasi web.

### Supabase Auth

Di Supabase Dashboard → Authentication → URL Configuration:

- **Site URL**: URL produksi, mis. `https://rab.example.com`.
- **Redirect URLs**: `https://rab.example.com/login`,
  `https://rab.example.com/register`, dan URL lokal
  `http://localhost:3000/login` bila diperlukan untuk pengembangan.

Aplikasi memakai redirect sisi klien setelah login; tidak ada route callback
server khusus. Pastikan konfirmasi email mengarah ke Site URL yang benar.

### Build dan jalankan

```bash
npm ci
npm run build
npm start
```

Hosting yang mendukung Next.js (mis. Vercel) dapat memakai build command
`npm run build` dan output standar Next.js. Untuk Node server, jalankan
`npm start` dengan environment di atas. Jangan memakai `npm run dev` di
produksi.

### Checklist rilis

- [ ] Versi `package.json` = `1.0.0`.
- [ ] `NEXT_PUBLIC_*` sudah diisi di hosting; service role tidak ada di client.
- [ ] Site URL/Redirect URLs Supabase cocok dengan domain produksi.
- [ ] Backup cleanup tersimpan di luar Git.
- [ ] `verify-empty` melaporkan 0 untuk enam tabel bisnis.
- [ ] Login akun masih berfungsi dan profil/perusahaan tetap ada.
- [ ] `npm run lint`, `tsc --noEmit`, dan `npm run build` lulus.
- [ ] Halaman kosong tidak menampilkan data contoh dan tidak membuat data
      otomatis saat login.
