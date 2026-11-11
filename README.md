# Smart Exam — Ujian Online (Vercel + Supabase)

Aplikasi ujian dengan kode unik, pembaca soal otomatis dari Word/Excel, dan rekap nilai ke Excel.
Siswa tidak perlu akun. Halaman & server di **Vercel**, data & gambar di **Supabase**.

## Isi repo

| File | Fungsi |
|---|---|
| `index.html` | Halaman aplikasi (siswa & guru) |
| `api/index.js` | Server API (dijalankan Vercel) |
| `lib/api.js` | Logika ujian: kode, masuk siswa, batas percobaan, penilaian |
| `lib/core.js` | Fungsi penilaian |
| `lib/supabase.js` | Penyimpanan ke Supabase |
| `lib/autosetup.js` | Membuat tabel otomatis saat pertama dipakai |
| `supabase-setup.sql` | Script pembuat tabel (dipakai otomatis, atau jalankan manual) |
| `package.json`, `vercel.json` | Pengaturan Vercel |

## Cara deploy (tanpa menyalin kunci, tanpa SQL)

1. **GitHub** — buat repo baru, unggah semua file folder ini apa adanya (folder `api/` dan `lib/` tetap folder).
2. **Vercel** — vercel.com → masuk dengan GitHub → **Add New… → Project** → pilih repo → **Deploy**.
3. **Supabase lewat Vercel** — di proyek Vercel: tab **Storage** → **Create Database** → pilih **Supabase** → ikuti (buat akun/proyek Supabase, Region **Singapore**) → **Connect** ke proyek ini. Vercel otomatis mengisi `SUPABASE_URL`, kunci, dan `POSTGRES_URL`.
4. **Deployments** → titik tiga deployment teratas → **Redeploy**.
5. Buka `https://nama-proyek.vercel.app/api` → harus muncul **Terhubung ke Supabase. Aplikasi siap dipakai.** Tabel & tempat gambar dibuat otomatis saat halaman ini dibuka pertama kali.

### Cara manual (jika tidak memakai integrasi Vercel)
Buat proyek di supabase.com → **SQL Editor** → jalankan `supabase-setup.sql` → di Vercel **Settings → Environment Variables** isi `SUPABASE_URL` (Project URL) dan `SUPABASE_SECRET_KEY` (Project Settings → API Keys → Secret key `sb_secret_...`, atau *service_role* di tab Legacy) → **Redeploy**.

## Pakai

- Buka `https://nama-proyek.vercel.app` → **Masuk sebagai Guru** → buat PIN → unggah soal → **SIMPAN DAN BUAT UJIAN**.
- Bagikan link dari tombol **Bagikan** (bentuknya `https://nama-proyek.vercel.app/?kode=ABC123`).

## Catatan

- **Kunci rahasia hanya di Vercel.** Jangan ditulis di `index.html`, jangan di-push ke GitHub.
- **Supabase gratis akan dijeda (pause) jika 7 hari tidak dipakai.** Buka dasbor Supabase → **Restore project** sebelum ujian.
- Lupa PIN guru: Supabase → **Table Editor → settings** → hapus baris `pinHash` dan `pinSalt` → buat PIN baru di aplikasi.
- Data hasil bisa dilihat di Supabase **Table Editor → results**, atau unduh Excel dari aplikasi.
