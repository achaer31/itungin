# Itungin — Finance + Kasir Utama Sate Javva

Sistem **finance + kasir terpadu** untuk Sate Javva. Satu aplikasi web, dipakai di tablet Android di warung.

## Apa yang sudah jadi di v1

- ✅ **Auth + 2 role** (`admin`, `kasir`) dengan frontend gate sederhana
- ✅ **Dashboard real-time** — laba hari/bulan, margin, target progress, breakeven badge, line chart pemasukan harian, donut pengeluaran, channel breakdown, menu paling untung (HPP), item terjual hari ini, menu terlaris bulan ini
- ✅ **Kasir / POS** — grid menu berfoto (emoji placeholder atau `foto_url`), kategori tabs (Sate/Sop/Minuman/Pelengkap), keranjang dengan qty +/− & catatan per item, channel selector (Dine-in/Take-away/WA), metode bayar (Tunai/QRIS)
- ✅ **Cetak Tiket Dapur** — tombol "Kirim ke Dapur" → save pesanan + cetak tiket TANPA harga, NO. MEJA besar untuk dapur
- ✅ **Cetak Struk Pelanggan** — saat "Bayar & Cetak Struk" → save/update + cetak struk dengan harga + total
- ✅ **HPP & Profit per Menu** — Master Bahan + Resep editor + tabel hitung otomatis profit per channel setelah komisi
- ✅ **Input Pemasukan/Pengeluaran** — Mode A (per hari) & Mode B (bulk grid, paste dari Excel)
- ✅ **Rekap bulanan** + export CSV
- ✅ **Pengaturan** — target bulanan + komisi platform (GoFood/Grab/Shopee/WA)
- ✅ **Schema SaaS-ready** — `outlet` table sudah ada, FK siap untuk multi-tenant

Mobile-first, tablet landscape friendly. Brand-matched dark theme (charcoal + ember).

---

## ⚙️ Setup

### 1. Supabase (database)

1. Buka [supabase.com](https://supabase.com) → **New Project** (free tier OK).
2. Tunggu provisioning (~2 menit).
3. **SQL Editor → New Query** → copy-paste seluruh isi [`supabase-schema.sql`](supabase-schema.sql) → **Run**.
   - Akan dibuat 7 tabel: `transaksi`, `pengaturan`, `bahan`, `menu`, `resep`, `pesanan`, `pesanan_item`
   - Plus seed data 14 menu (sate ayam/kambing B&D aja, sop ayam/kambing, minuman, pelengkap)
   - Plus RLS policies (default: anon access — lihat catatan keamanan di bawah)
4. **Settings → API** → copy:
   - **Project URL** (`https://xxx.supabase.co`)
   - **anon public** key (yang panjang, bukan service_role)

### 2. Config app

Edit [`assets/js/config.js`](assets/js/config.js):

```js
window.ITUNGIN_CONFIG = {
  SUPABASE_URL:      "https://YOUR-PROJECT.supabase.co",  // ← paste di sini
  SUPABASE_ANON_KEY: "eyJhbGc...",                         // ← paste di sini

  USERS: [
    { username: "gayuh", role: "admin" },
    { username: "yoan",  role: "admin" },
    { username: "abdu",  role: "admin" },
    { username: "anton", role: "kasir" }
  ],
  PASSWORD: "satejavva2026",
  DEFAULT_TARGET_BULANAN: 10000000
};
```

### 3. Test lokal

Buka `index.html` di browser. Atau pakai mini server:

```powershell
cd "c:\Users\mralo\Desktop\itungin"
python -m http.server 5500
# Buka http://localhost:5500
```

Login dengan user di atas (password: `satejavva2026`).

---

## 🚀 Deploy ke Vercel + Subdomain

### A. Push ke GitHub

```powershell
cd "c:\Users\mralo\Desktop\itungin"
git init
git add .
git commit -m "Initial commit - Itungin"
git branch -M main

# Buat repo baru di github.com (mis. achaer31/itungin), JANGAN init README
git remote add origin https://github.com/achaer31/itungin.git
git push -u origin main
```

### B. Connect Vercel

1. Buka [vercel.com/new](https://vercel.com/new)
2. Pilih akun **achaer31** (personal — bukan GitHub Org karena Hobby plan gak support org)
3. Import repo `itungin` → Application Preset: **Other** → Deploy
4. Selesai dalam ~20 detik, dapat URL `*.vercel.app`

### C. Pasang subdomain `itungin.satejavva.com`

1. Di Vercel project Itungin → **Settings → Domains**
2. Add domain: `itungin.satejavva.com`
3. Vercel kasih instruksi DNS:
   - **CNAME** `itungin` → `cname.vercel-dns.com`
4. Buka registrar domain `satejavva.com`, tambahkan record:
   - Type: `CNAME`
   - Host: `itungin`
   - Value: `cname.vercel-dns.com`
5. Tunggu 5–30 menit untuk propagasi DNS + SSL otomatis aktif.

---

## 📝 Workflow Update

```powershell
cd "c:\Users\mralo\Desktop\itungin"
# edit file yang mau diubah
git add .
git commit -m "..."
git push
```

Vercel auto-deploy ulang dalam ~15 detik.

---

## 🧑‍🍳 Cara Pakai

### Pertama Kali — Setup HPP

Sebelum dashboard kasih angka profit akurat, admin perlu setup HPP:

1. Login sebagai admin → tab **HPP & Profit**
2. Sub-tab **🥩 Bahan Baku** → klik "+ Tambah Bahan" untuk tiap bahan:
   - Daging ayam (kg) — harga per kg
   - Daging kambing (kg) — harga per kg
   - Tusuk sate (pcs) — harga per pcs
   - Bumbu kacang (porsi) — biaya rata-rata per porsi
   - Lontong, lalapan, kerupuk (porsi/pcs)
   - Arang/gas (porsi — estimasi)
   - Packaging (pcs)
   - Bahan minuman (teh, gula, jeruk, kopi)
3. Sub-tab **📝 Resep Menu** → pilih menu satu per satu, tentukan komposisi bahan + jumlah
4. Sub-tab **📊 Profit Menu** → tabel otomatis muncul dengan HPP + profit per channel

### Harian — Kasir POS (Dine-in)

1. Login sebagai `anton` (kasir) atau admin → tab **🛒 Kasir**
2. Klik menu dari grid → masuk keranjang otomatis
3. Pilih channel (Dine-in / Take-away / WA), isi nama meja kalau perlu
4. Klik **Bayar & Selesai** → pesanan tersimpan, otomatis nambah pemasukan hari ini

### Harian — Input Manual (GoFood/Grab/Shopee)

Karena penjualan app gak lewat kasir, harus diinput manual dari laporan platform:

1. Login admin → tab **Input** → Mode A (Per Hari)
2. Pilih tanggal, isi nominal di kolom GoFood / GrabFood / ShopeeFood
3. Isi pengeluaran hari itu juga (bahan, gaji, dll)
4. **Simpan Data Hari Ini**

Untuk input bulk (mis. masukin data 1 bulan kebelakang dari spreadsheet), pakai **Mode B**:
- Klik "Mode B · Bulk Grid"
- Tambah baris per tanggal, isi sel-sel
- **Bisa paste langsung dari Excel/Google Sheets** (copy blok di spreadsheet, paste di sel grid)
- Klik **Simpan Semua**

### Bulanan — Lihat Performa

Tab **Dashboard** untuk overview real-time. Tab **Rekap** untuk tabel per hari + export CSV.

---

## 🔐 Catatan Keamanan

⚠️ **Login frontend ini BUKAN keamanan sungguhan.** Username/password ada di `config.js` (visible via view-source). Anon key Supabase juga ada di frontend — siapa pun yang punya URL Supabase + anon key bisa akses langsung database lewat tools eksternal.

Frontend gate ini cukup untuk pembatas praktis ke staf (orang luar gak tau ada `/itungin.satejavva.com`). Tapi **jangan publish password di repository publik** — pakai env vars atau .gitignore `config.js`.

### Upgrade ke Keamanan Sungguhan (Supabase Auth)

Kalau perlu real auth, lakukan:

1. Supabase → **Authentication → Email** → enable, undang user via email
2. Update `config.js` → ganti USERS/PASSWORD ke `supa.auth.signInWithPassword({ email, password })`
3. Update RLS policies di `supabase-schema.sql`:
   ```sql
   DROP POLICY "anon_all_transaksi" ON public.transaksi;
   CREATE POLICY "auth_all_transaksi" ON public.transaksi
     FOR ALL TO authenticated USING (true) WITH CHECK (true);
   ```
4. Tambah app metadata `role` per user, cek di policy:
   ```sql
   CREATE POLICY "admin_modify" ON public.pengaturan
     FOR UPDATE TO authenticated
     USING ((auth.jwt() ->> 'role') = 'admin');
   ```

---

## 🗄️ Struktur File

```
itungin/
├── index.html                  # SPA single page, semua view di sini
├── assets/
│   ├── css/styles.css          # Brand-matched dark theme
│   ├── js/
│   │   ├── config.js           # ← Edit: Supabase keys + USERS (gitignore!)
│   │   ├── config.example.js   # Template
│   │   └── app.js              # All logic: router, auth, data, views
│   └── images/logo.png
├── supabase-schema.sql         # Run di Supabase SQL Editor
├── vercel.json
├── .gitignore
└── README.md
```

## 🎨 Kustomisasi

- **Tambah kategori pemasukan/pengeluaran:** edit `KATEGORI_PEMASUKAN` / `KATEGORI_PENGELUARAN` di `app.js`
- **Ubah warna brand:** edit CSS variables di top `styles.css` (`--ember`, `--amber`, dll)
- **Tambah menu:** lewat UI di tab HPP & Profit → Resep Menu (atau lewat seed di `supabase-schema.sql`)
- **Tambah user:** edit `USERS` di `config.js`

## ❓ Troubleshooting

**App tampil "Setup Supabase dulu"** → belum isi `config.js` dengan URL & anon key.

**Login berhasil tapi data kosong / error fetch** → cek di Supabase SQL Editor apakah tabel sudah dibuat & RLS policies aktif. Run `supabase-schema.sql` ulang (idempotent, aman di-run berulang kali).

**Kasir gak bisa lihat tab Kasir** → cek di `config.js` apakah user-nya role `'kasir'` atau `'admin'`.

**HPP semua nol** → belum input bahan + resep. Login admin → HPP & Profit → tambah bahan dulu → set resep per menu.

---

## 🗺️ Roadmap — Yang Belum & Cara Lanjutkan

V1 ini sudah punya fondasi: schema, POS, HPP, dashboard, struk, tiket dapur. Yang berikut belum diimplementasi tapi **schema & arsitektur sudah disiapkan** — tinggal lanjut iterasi.

### 1. ⏳ QRIS Dinamis via Xendit (auto-konfirmasi pembayaran)

**Status:** Tabel `pembayaran` sudah ada. Edge Functions belum.

**Yang perlu dibuat:**

1. **Edge Function: `create-qris`** — di Supabase Dashboard → Edge Functions → New Function:
   ```ts
   // supabase/functions/create-qris/index.ts
   import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
   serve(async (req) => {
     const { pesanan_id, amount } = await req.json();
     const res = await fetch("https://api.xendit.co/qr_codes", {
       method: "POST",
       headers: {
         "Authorization": "Basic " + btoa(Deno.env.get("XENDIT_SECRET_KEY") + ":"),
         "Content-Type": "application/json",
         "api-version": "2022-07-31"
       },
       body: JSON.stringify({
         reference_id: `sj-${pesanan_id}-${Date.now()}`,
         type: "DYNAMIC",
         currency: "IDR",
         amount,
         expires_at: new Date(Date.now() + 15*60*1000).toISOString()
       })
     });
     const data = await res.json();
     // TODO: insert ke pembayaran table via Supabase admin client
     return new Response(JSON.stringify({ qr_string: data.qr_string, xendit_id: data.id }));
   });
   ```

2. **Edge Function: `xendit-webhook`** — endpoint penerima callback:
   ```ts
   serve(async (req) => {
     const token = req.headers.get("x-callback-token");
     if (token !== Deno.env.get("XENDIT_WEBHOOK_TOKEN")) {
       return new Response("Unauthorized", { status: 401 });
     }
     const event = await req.json();
     if (event.status === "SUCCEEDED" || event.status === "ACTIVE") {
       // update pembayaran.status='LUNAS' + pesanan.status='lunas'
     }
     return new Response("OK");
   });
   ```

3. **Set Supabase secrets** via Dashboard → Project Settings → Edge Functions → Secrets:
   - `XENDIT_SECRET_KEY` (dari Xendit Dashboard, **Mode Test** dulu)
   - `XENDIT_WEBHOOK_TOKEN` (dari Xendit Dashboard → Webhook settings)

4. **Daftarkan webhook URL** di Xendit Dashboard:
   - URL: `https://YOUR-PROJECT.supabase.co/functions/v1/xendit-webhook`

5. **Frontend (app.js):** ganti tombol "Bayar & Cetak Struk" untuk QRIS jadi panggil Edge Function, render QR (pakai library `qrcode.js` via CDN), polling status pembayaran tiap 3 detik. Tampilkan "Lunas ✓" otomatis.

**⚠️ Catatan:** Fee Xendit ~0.7%/transaksi QRIS — masukkan ke perhitungan margin.

### 2. ⏳ Bluetooth Thermal Printer (langsung, tanpa app jembatan)

**Status:** Cetak v1 pakai `window.print()` browser → bisa ke printer thermal lewat **app jembatan** seperti **RawBT** (Android) atau **Print Plus**. Workflow: klik tombol → pilih app printer → kertas keluar.

**Untuk Web Bluetooth langsung** (no app needed), ganti `printReceipt()` & `printKitchenTicket()` di `app.js`:

```js
async function printToBluetooth(escposBytes) {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }]
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
  const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
  // Send in chunks of 100 bytes (BLE MTU limit)
  for (let i = 0; i < escposBytes.length; i += 100) {
    await characteristic.writeValue(escposBytes.slice(i, i + 100));
  }
  device.gatt.disconnect();
}
```

Plus generate ESC/POS bytes (header, alignment, double-size, cut commands). Library yang bisa dipakai: [`esc-pos-encoder`](https://github.com/NielsLeenheer/EscPosEncoder) via CDN.

**Catatan:** Web Bluetooth cuma jalan di **Chrome/Edge di Android/desktop**, gak di Safari iOS. Untuk tablet Android: ✅ jalan.

### 3. ⏳ Foto Menu Upload (Supabase Storage)

**Status:** Field `menu.foto_url` sudah ada. UI upload belum dibuat.

**Yang perlu:**
1. Buat bucket `menu-photos` di Supabase Storage (public).
2. Tambah tombol "Upload Foto" di HPP & Profit → tab Bahan Baku (atau view Menu Management baru), upload via `supa.storage.from('menu-photos').upload(...)`.
3. Save returned public URL ke `menu.foto_url`.

Sekarang grid kasir otomatis show emoji per kategori sebagai placeholder.

### 4. ⏳ Multi-Outlet (SaaS)

**Status:** Tabel `outlet` ada, `menu.outlet_id` FK ada (default 1). Belum dipakai untuk filter di queries.

**Yang perlu ketika mau jadi SaaS:**
1. Tambah `outlet_id` FK ke semua tabel (`transaksi`, `pesanan`, `pengaturan`, dll)
2. User session simpan `outlet_id`
3. Semua query di `fetchTransaksi`, `fetchPesanan`, dll filter by `outlet_id`
4. Multi-tenant Auth (Supabase Auth dengan user_metadata.outlet_id)

### 5. ⏳ Real-time Dashboard Updates

**Status:** Dashboard refresh manual via tombol ↻.

**Yang perlu:** Subscribe ke Supabase Realtime:
```js
supa.channel('dashboard-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'pesanan' },
      () => loadDashboard())
  .on('postgres_changes', { event: '*', schema: 'public', table: 'transaksi' },
      () => loadDashboard())
  .subscribe();
```

### 6. ⏳ Menu Management UI

**Status:** Tambah menu cuma lewat seed SQL atau direct edit Supabase Table Editor.

**Yang perlu:** View baru `#/menu-manage` (admin only) untuk tambah/edit/hapus/upload foto menu. Schema sudah siap.

---

## 🧪 Testing Checklist (sebelum live)

- [ ] Setup Supabase: schema, anon key di config.js
- [ ] Tambah bahan + resep untuk semua 14 menu di HPP & Profit
- [ ] Tes login per role (admin & kasir) — pastikan kasir gak bisa akses HPP/Pengaturan
- [ ] Tes POS Mode 1 (dine-in dengan no_meja) → "Kirim ke Dapur" → tiket dapur tercetak tanpa harga
- [ ] Tes POS Mode 2 → "Bayar & Cetak Struk" → struk pelanggan tercetak dengan harga
- [ ] Tes Input Mode A & Mode B (paste dari spreadsheet)
- [ ] Tes Rekap + Export CSV
- [ ] Cek Dashboard menu terlaris, item terjual hari ini, channel breakdown
- [ ] (kalau pakai Xendit) — tes pembayaran QRIS di mode Test sampai status auto-LUNAS
- [ ] Tes cetak ke printer thermal asli (via RawBT atau Web Bluetooth)
- [ ] Latih kasir (anton) pakai POS saat sepi sebelum dipakai rame
