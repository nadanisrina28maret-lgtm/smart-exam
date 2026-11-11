-- =========================================================
-- SMART EXAM — jalankan SEKALI di Supabase: SQL Editor → New query → Run
-- =========================================================

-- Pengaturan guru (PIN tersimpan dalam bentuk acak/hash)
create table if not exists public.settings (
  key   text primary key,
  value text
);

-- Daftar ujian + isi soal
create table if not exists public.exams (
  kode       text primary key,
  nama       text,
  mapel      text,
  meta       jsonb not null,
  content    jsonb not null,
  created_at timestamptz default now()
);

-- Hasil / peserta ujian
create table if not exists public.results (
  id           text primary key,
  kode         text not null references public.exams(kode) on delete cascade,
  nama_key     text not null,
  percobaan_ke int  not null,
  nama         text,
  kelas        text,
  status       text,
  nilai        numeric,
  data         jsonb not null,
  updated_at   timestamptz default now(),
  unique (kode, nama_key, percobaan_ke)
);
create index if not exists results_kode_idx on public.results (kode);

-- Kunci akses: tabel hanya bisa dibaca/ditulis oleh server (kunci rahasia),
-- bukan oleh siapa pun dari browser. Jangan tambahkan policy apa pun.
alter table public.settings enable row level security;
alter table public.exams    enable row level security;
alter table public.results  enable row level security;

-- Tempat menyimpan gambar soal (boleh dilihat publik agar tampil di HP siswa)
insert into storage.buckets (id, name, public)
values ('soal-gambar', 'soal-gambar', true)
on conflict (id) do nothing;

-- Selesai. Jika muncul "Success. No rows returned", berarti berhasil.
