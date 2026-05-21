/* ================================================================
   Itungin — Config Template
   ================================================================
   COPY file ini jadi `config.js` lalu isi nilai-nilainya.
   `config.js` di-gitignore supaya credentials gak ter-commit.

   Untuk Vercel deploy: set SUPABASE_URL dan SUPABASE_ANON_KEY
   sebagai env vars (lihat README.md), atau hardcode di config.js
   (anon key memang aman untuk frontend tapi tetap jangan ke repo publik).
================================================================ */

window.ITUNGIN_CONFIG = {
  // Dari Supabase: Settings → API → "Project URL" & "anon public" key
  SUPABASE_URL:      "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY-HERE",

  // Daftar user yang boleh login. Role:
  //   - 'admin': akses semua fitur (input transaksi, HPP, pengaturan, kasir)
  //   - 'kasir': akses Kasir + Dashboard (tidak bisa ubah HPP/pengaturan/hapus historis)
  // Password sama untuk semua user di bawah.
  USERS: [
    { username: "gayuh", role: "admin" },
    { username: "yoan",  role: "admin" },
    { username: "abdu",  role: "admin" },
    { username: "anton", role: "kasir" }
  ],
  PASSWORD: "satejavva2026",

  // Default kalau tabel pengaturan belum ada datanya
  DEFAULT_TARGET_BULANAN: 10000000,

  // Kategori — kalau mau tambah/ubah, edit di sini DAN di
  // app.js (KATEGORI_PEMASUKAN & KATEGORI_PENGELUARAN)
};
