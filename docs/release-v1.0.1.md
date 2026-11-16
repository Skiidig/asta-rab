# Rilis v1.0.1 — Identitas Perusahaan Bersih dan Favicon Astaworks

Rilis minor ini tidak mengubah skema database, RLS, rumus RAB, pembulatan,
maupun data pekerjaan. Tidak ada migration yang perlu dijalankan.

## 1. Identitas perusahaan default kosong

Sebelum rilis ini, `src/lib/profile.ts` memakai fallback contoh
("Mitra Konstruksi Nusantara", alamat Tebet, telepon, dan email contoh) ketika
akun belum memiliki metadata `company`. Fallback itulah yang tampil di form,
pratinjau, PDF, dan Excel.

Perubahan:

- `companyProfile` kini berisi string kosong untuk nama, alamat, telepon, dan
  email. `currency` tetap `IDR`.
- `resolveCompanyProfile()` tetap memakai nilai tersimpan apa adanya, termasuk
  string kosong yang sengaja disimpan pengguna.
- Tidak ada lagi pemakaian email login sebagai email perusahaan. Email akun
  tetap berasal dari Supabase Auth dan tetap readonly di Pengaturan.
- Contoh pengisian hanya menjadi `placeholder` pada field; placeholder tidak
  pernah menjadi nilai formulir atau ikut tersimpan.
- Field identitas perusahaan bersifat opsional. Pengguna dapat mengosongkan
  sebagian atau seluruh kolom lalu menekan Simpan; setelah refresh nilainya
  tetap kosong.
- Metadata `company` milik akun lain tidak disentuh. Penyimpanan tetap memakai
  `supabase.auth.updateUser({ data: { ... } })` pada akun yang sedang masuk.

### Dummy yang sudah tersimpan

Fallback kode dan data tersimpan adalah dua hal berbeda:

- **Fallback kode** (nilai contoh lama) hilang dengan perubahan ini dan tidak
  pernah muncul lagi untuk akun tanpa metadata.
- **Dummy tersimpan** adalah nilai contoh yang sudah masuk ke
  `user_metadata.company` karena pengguna menekan Simpan saat form masih
  terisi contoh. Nilai seperti ini tidak dapat dibedakan secara otomatis dari
  perusahaan asli yang kebetulan bernama sama. Karena itu rilis ini **tidak**
  menghapus metadata akun mana pun. Pengguna dapat membersihkannya sendiri
  melalui **Pengaturan → Identitas Perusahaan** (kosongkan kolom, lalu Simpan),
  dan hasilnya bertahan setelah refresh.

## 2. Pratinjau dan ekspor

- **Pratinjau Pengaturan** hanya menampilkan nilai yang diisi pengguna. Bila
  identitas kosong, tampil keterangan bahwa kop hanya memuat judul dan
  informasi proyek. Branding aplikasi (logo Astaworks dan "Dibuat dengan
  RAB Mini") dipisahkan dari identitas perusahaan.
- **PDF:** nama perusahaan hanya digambar bila terisi; baris kontak hanya
  digambar bila telepon dan/atau email terisi, digabung dengan `·` tanpa
  pemisah menggantung. Tinggi kop mengikuti isinya sehingga judul tidak
  menyisakan ruang kosong berlebih. Footer selalu memuat branding aplikasi.
- **Excel:** baris nama dan kontak yang kosong tidak ditulis. Posisi header
  tabel, merge, freeze pane, dan rentang formula dihitung dari jumlah baris kop
  aktual. Nilai, rumus, subtotal, dan grand total tidak berubah.
- **Perbandingan PDF/Excel** tidak memakai identitas perusahaan, jadi tidak ada
  perubahan pada alur tersebut.

## 3. Favicon

- `src/app/icon.png` (256×256) dan `src/app/favicon.ico` (16–256 px) dibuat dari
  aset asli `src/assets/branding/astaworks-arrow.png` tanpa menggambar ulang
  logo. Rasio dan transparansi dipertahankan.
- Favicon bawaan Next.js sudah diganti seluruhnya. Metadata ikon tetap memakai
  file convention Next.js (tidak ada `icons` ganda di `layout.tsx`).
- Arrow tidak ditambahkan ke header mobile/tablet.
- Tidak ada pemblokiran klik kanan/penyimpanan gambar; logo tetap aset publik.

## 4. Versi

Satu sumber versi: `package.json` (`1.0.1`) dibaca oleh
`src/lib/app-version.ts`. Footer sidebar menampilkan `RAB Mini v1.0.1`.
`package-lock.json` disamakan.

## 5. Verifikasi rilis

Jalankan dari akar proyek:

```bash
npm run lint
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

Pemeriksaan manual yang disarankan:

- [ ] Akun baru/tanpa metadata `company`: form identitas kosong, placeholder
      tidak ikut tersimpan.
- [ ] Isi identitas lengkap → Simpan → refresh: nilai tetap sama.
- [ ] Kosongkan alamat/telepon/email → Simpan → refresh: tetap kosong.
- [ ] Akun lain dengan identitas asli tidak berubah.
- [ ] Pratinjau, PDF, dan Excel untuk identitas kosong, sebagian, dan lengkap.
- [ ] Tidak ada `·` menggantung atau baris kontak kosong di PDF/Excel.
- [ ] Favicon baru terlihat setelah hard refresh/incognito.
- [ ] Desktop/mobile dan tema terang/gelap tetap rapi.

Pengujian yang memakai fixture/kode bukan pengganti pengujian akun nyata.
Jangan mengklaim penyimpanan live berhasil bila akun Supabase sungguhan belum
diuji.

## 6. Deployment

Rilis ini dikirim lewat commit ke `main` tanpa force push. Vercel menjalankan
deployment otomatis dari integrasi Git. Setelah status deployment **Ready**:

- buka `https://asta-rab.vercel.app` dan pastikan footer menampilkan
  `RAB Mini v1.0.1`;
- lakukan hard refresh/incognito dan pastikan favicon arrow tampil;
- periksa `Content-Type`/ukuran ikon baru dan tidak ada favicon lama yang
  menggantikannya.

Jangan menyimpan kredensial, backup, `.env.local`, atau artefak pengujian di
Git.
