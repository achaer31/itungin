-- ================================================================
-- Itungin — Supabase Schema (lengkap dengan modul HPP)
-- ================================================================
-- Cara pakai:
-- 1. Buka https://supabase.com → New Project (free tier OK)
-- 2. SQL Editor → New Query → copy-paste seluruh file ini → Run
-- 3. Settings → API → copy URL & "anon" public key → paste ke
--    assets/js/config.js
-- ================================================================

-- ================================================================
-- TABLE: outlet (SaaS-ready scaffolding)
-- Untuk single-tenant sekarang: 1 row (id=1 = Sate Javva Pondok Ranji).
-- Kalau nanti multi-tenant, tambah row + foreign key di tabel lain.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.outlet (
  id          BIGSERIAL PRIMARY KEY,
  nama        TEXT NOT NULL,
  alamat      TEXT,
  telepon     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.outlet (id, nama, alamat, telepon)
  VALUES (1, 'Sate Javva — Pondok Ranji',
          'Jl. Nusa Jaya No.4, RT02/RW 04, Pondok Ranji, Pondok Aren, Tangsel',
          '+62 856 1578 404')
ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- TABLE: transaksi
-- ================================================================
CREATE TABLE IF NOT EXISTS public.transaksi (
  id           BIGSERIAL PRIMARY KEY,
  tanggal      DATE NOT NULL,
  tipe         TEXT NOT NULL CHECK (tipe IN ('pemasukan', 'pengeluaran')),
  kategori     TEXT NOT NULL,
  nominal      NUMERIC(15, 2) NOT NULL DEFAULT 0,
  catatan      TEXT,
  dibuat_oleh  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transaksi_tanggal  ON public.transaksi (tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_transaksi_tipe     ON public.transaksi (tipe);
CREATE INDEX IF NOT EXISTS idx_transaksi_kategori ON public.transaksi (kategori);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaksi_updated_at ON public.transaksi;
CREATE TRIGGER trg_transaksi_updated_at
  BEFORE UPDATE ON public.transaksi
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================
-- TABLE: pengaturan (single row)
-- target_bulanan + komisi per platform
-- (modal_per_porsi tetap ada untuk backward-compat, tapi sekarang
--  modal sebenernya dihitung dari modul HPP)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.pengaturan (
  id                  INT PRIMARY KEY DEFAULT 1,
  modal_per_porsi     NUMERIC(15, 2) NOT NULL DEFAULT 0,
  target_bulanan      NUMERIC(15, 2) NOT NULL DEFAULT 10000000,
  komisi_gofood       NUMERIC(5, 2)  NOT NULL DEFAULT 20.00,
  komisi_grabfood     NUMERIC(5, 2)  NOT NULL DEFAULT 20.00,
  komisi_shopeefood   NUMERIC(5, 2)  NOT NULL DEFAULT 20.00,
  komisi_wa           NUMERIC(5, 2)  NOT NULL DEFAULT 0.00,
  komisi_dinein       NUMERIC(5, 2)  NOT NULL DEFAULT 0.00,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pengaturan_single_row CHECK (id = 1)
);

INSERT INTO public.pengaturan (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_pengaturan_updated_at ON public.pengaturan;
CREATE TRIGGER trg_pengaturan_updated_at
  BEFORE UPDATE ON public.pengaturan
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Pastikan kolom komisi ada (untuk yang sudah pernah run versi lama)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='pengaturan' AND column_name='komisi_gofood') THEN
    ALTER TABLE public.pengaturan ADD COLUMN komisi_gofood     NUMERIC(5,2) NOT NULL DEFAULT 20.00;
    ALTER TABLE public.pengaturan ADD COLUMN komisi_grabfood   NUMERIC(5,2) NOT NULL DEFAULT 20.00;
    ALTER TABLE public.pengaturan ADD COLUMN komisi_shopeefood NUMERIC(5,2) NOT NULL DEFAULT 20.00;
    ALTER TABLE public.pengaturan ADD COLUMN komisi_wa         NUMERIC(5,2) NOT NULL DEFAULT 0.00;
    ALTER TABLE public.pengaturan ADD COLUMN komisi_dinein     NUMERIC(5,2) NOT NULL DEFAULT 0.00;
  END IF;
END $$;

-- ================================================================
-- TABLE: bahan (master bahan baku)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.bahan (
  id                BIGSERIAL PRIMARY KEY,
  nama              TEXT NOT NULL,
  satuan            TEXT NOT NULL CHECK (satuan IN ('kg','gram','liter','ml','pcs','porsi')),
  harga_per_satuan  NUMERIC(15, 2) NOT NULL DEFAULT 0,
  catatan           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bahan_nama ON public.bahan (LOWER(nama));

DROP TRIGGER IF EXISTS trg_bahan_updated_at ON public.bahan;
CREATE TRIGGER trg_bahan_updated_at
  BEFORE UPDATE ON public.bahan
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================
-- TABLE: menu (daftar menu jual + harga)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.menu (
  id           BIGSERIAL PRIMARY KEY,
  outlet_id    BIGINT REFERENCES public.outlet(id) DEFAULT 1,
  nama         TEXT NOT NULL,
  kategori     TEXT NOT NULL DEFAULT 'Sate',
  harga_jual   NUMERIC(15, 2) NOT NULL DEFAULT 0,
  foto_url     TEXT,                                  -- URL foto untuk grid kasir
  catatan      TEXT,
  urutan       INT NOT NULL DEFAULT 0,
  aktif        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pastikan kolom foto_url & aktif ada (untuk migration kalau pernah run versi lama)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='menu' AND column_name='foto_url') THEN
    ALTER TABLE public.menu ADD COLUMN foto_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='menu' AND column_name='aktif') THEN
    ALTER TABLE public.menu ADD COLUMN aktif BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='menu' AND column_name='outlet_id') THEN
    ALTER TABLE public.menu ADD COLUMN outlet_id BIGINT REFERENCES public.outlet(id) DEFAULT 1;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_nama ON public.menu (LOWER(nama));

DROP TRIGGER IF EXISTS trg_menu_updated_at ON public.menu;
CREATE TRIGGER trg_menu_updated_at
  BEFORE UPDATE ON public.menu
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================
-- TABLE: resep (komposisi bahan per menu)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.resep (
  id         BIGSERIAL PRIMARY KEY,
  menu_id    BIGINT NOT NULL REFERENCES public.menu(id) ON DELETE CASCADE,
  bahan_id   BIGINT NOT NULL REFERENCES public.bahan(id) ON DELETE RESTRICT,
  jumlah     NUMERIC(15, 4) NOT NULL DEFAULT 0,
  catatan    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (menu_id, bahan_id)
);
CREATE INDEX IF NOT EXISTS idx_resep_menu  ON public.resep (menu_id);
CREATE INDEX IF NOT EXISTS idx_resep_bahan ON public.resep (bahan_id);

DROP TRIGGER IF EXISTS trg_resep_updated_at ON public.resep;
CREATE TRIGGER trg_resep_updated_at
  BEFORE UPDATE ON public.resep
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================
-- Seed data: menu Sate Javva (idempotent — gak di-overwrite kalau sudah ada)
-- ================================================================
INSERT INTO public.menu (nama, kategori, harga_jual, urutan) VALUES
  ('Sate Ayam B aja',     'Sate', 25000, 1),
  ('Sate Ayam D aja',     'Sate', 27000, 2),
  ('Sate Kambing B aja',  'Sate', 35000, 3),
  ('Sate Kambing D aja',  'Sate', 38000, 4),
  ('Sop Ayam',            'Sop',  20000, 5),
  ('Sop Kambing',         'Sop',  30000, 6),
  ('Teh Solo Manis',      'Minuman', 5000, 7),
  ('Jeruk Panas/Dingin',  'Minuman', 7000, 8),
  ('Es Kopi Mafia',       'Minuman', 18000, 9),
  ('Kopi Ireng Panas',    'Minuman', 10000, 10),
  ('Lontong e Pakdhe',    'Pelengkap', 6000, 11),
  ('Nasi e Mbah Mulyono', 'Pelengkap', 6000, 12),
  ('Kerupuk',             'Pelengkap', 3000, 13),
  ('Lalapan',             'Pelengkap', 5000, 14)
ON CONFLICT (LOWER(nama)) DO NOTHING;

-- ================================================================
-- TABLE: pesanan (POS — header pesanan dine-in/take-away/WA)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.pesanan (
  id              BIGSERIAL PRIMARY KEY,
  waktu           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel         TEXT NOT NULL DEFAULT 'Dine-in' CHECK (channel IN ('Dine-in','Take-away','WA')),
  kasir           TEXT,
  total           NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_hpp       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  metode_bayar    TEXT CHECK (metode_bayar IN ('Tunai','QRIS')),
  meja_atau_nama  TEXT,
  status          TEXT NOT NULL DEFAULT 'selesai' CHECK (status IN ('selesai','batal')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pesanan_waktu   ON public.pesanan (waktu DESC);
CREATE INDEX IF NOT EXISTS idx_pesanan_channel ON public.pesanan (channel);
CREATE INDEX IF NOT EXISTS idx_pesanan_status  ON public.pesanan (status);

DROP TRIGGER IF EXISTS trg_pesanan_updated_at ON public.pesanan;
CREATE TRIGGER trg_pesanan_updated_at
  BEFORE UPDATE ON public.pesanan
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================
-- TABLE: pesanan_item (POS — detail item per pesanan dengan snapshot harga & HPP)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.pesanan_item (
  id          BIGSERIAL PRIMARY KEY,
  pesanan_id  BIGINT NOT NULL REFERENCES public.pesanan(id) ON DELETE CASCADE,
  menu_id     BIGINT REFERENCES public.menu(id) ON DELETE SET NULL,
  nama_menu   TEXT NOT NULL,                          -- snapshot nama
  qty         INT NOT NULL DEFAULT 1 CHECK (qty > 0),
  harga       NUMERIC(15, 2) NOT NULL DEFAULT 0,      -- snapshot harga jual saat itu
  hpp         NUMERIC(15, 2) NOT NULL DEFAULT 0,      -- snapshot HPP saat itu
  subtotal    NUMERIC(15, 2) NOT NULL DEFAULT 0,      -- harga × qty
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pesanan_item_pesanan ON public.pesanan_item (pesanan_id);
CREATE INDEX IF NOT EXISTS idx_pesanan_item_menu    ON public.pesanan_item (menu_id);

-- ================================================================
-- TABLE: pembayaran (Xendit QRIS-ready scaffolding)
-- Edge Function `create-qris` insert row dengan status PENDING.
-- Webhook `xendit-webhook` update status ke LUNAS/GAGAL.
-- Belum di-wire ke frontend di v1 — lihat README "Next Steps".
-- ================================================================
CREATE TABLE IF NOT EXISTS public.pembayaran (
  id          BIGSERIAL PRIMARY KEY,
  pesanan_id  BIGINT NOT NULL REFERENCES public.pesanan(id) ON DELETE CASCADE,
  xendit_ref  TEXT,                                    -- external_id / reference
  xendit_qr_string TEXT,                               -- raw QR string untuk render QR
  amount      NUMERIC(15, 2) NOT NULL,
  metode      TEXT NOT NULL DEFAULT 'QRIS' CHECK (metode IN ('QRIS','TUNAI','QRIS_STATIS')),
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','LUNAS','GAGAL','EXPIRED')),
  payload     JSONB,                                   -- simpan raw payload Xendit
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pembayaran_pesanan ON public.pembayaran (pesanan_id);
CREATE INDEX IF NOT EXISTS idx_pembayaran_status  ON public.pembayaran (status);
CREATE INDEX IF NOT EXISTS idx_pembayaran_ref     ON public.pembayaran (xendit_ref);

DROP TRIGGER IF EXISTS trg_pembayaran_updated_at ON public.pembayaran;
CREATE TRIGGER trg_pembayaran_updated_at
  BEFORE UPDATE ON public.pembayaran
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE public.outlet       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaksi    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengaturan   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bahan        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resep        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesanan      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesanan_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pembayaran   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_outlet"       ON public.outlet;
DROP POLICY IF EXISTS "anon_all_transaksi"    ON public.transaksi;
DROP POLICY IF EXISTS "anon_all_pengaturan"   ON public.pengaturan;
DROP POLICY IF EXISTS "anon_all_bahan"        ON public.bahan;
DROP POLICY IF EXISTS "anon_all_menu"         ON public.menu;
DROP POLICY IF EXISTS "anon_all_resep"        ON public.resep;
DROP POLICY IF EXISTS "anon_all_pesanan"      ON public.pesanan;
DROP POLICY IF EXISTS "anon_all_pesanan_item" ON public.pesanan_item;
DROP POLICY IF EXISTS "anon_all_pembayaran"   ON public.pembayaran;

CREATE POLICY "anon_all_outlet"       ON public.outlet       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_transaksi"    ON public.transaksi    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_pengaturan"   ON public.pengaturan   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_bahan"        ON public.bahan        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_menu"         ON public.menu         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_resep"        ON public.resep        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_pesanan"      ON public.pesanan      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_pesanan_item" ON public.pesanan_item FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_pembayaran"   ON public.pembayaran   FOR ALL TO anon USING (true) WITH CHECK (true);

-- ================================================================
-- Done. Cek di Table Editor → harus muncul 9 tabel:
-- outlet, transaksi, pengaturan, bahan, menu, resep, pesanan,
-- pesanan_item, pembayaran
-- ================================================================
