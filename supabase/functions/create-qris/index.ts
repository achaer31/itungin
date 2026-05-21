// ================================================================
// Edge Function: create-qris
// ================================================================
// Called by frontend Itungin when kasir pilih metode QRIS.
// 1. Call Xendit /qr_codes API to create DYNAMIC QR with amount
// 2. Save record to public.pembayaran (status='PENDING')
// 3. Return qr_string ke frontend untuk di-render sebagai QR code
//
// Required secrets (set via Dashboard → Edge Functions → Secrets):
//   - XENDIT_SECRET_KEY     (dari Xendit Dashboard, mode Test/Live)
//
// Auto-available secrets (Supabase set otomatis):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
// ================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pesanan_id, amount } = await req.json();

    if (!pesanan_id || !amount || amount <= 0) {
      return new Response(
        JSON.stringify({ error: "pesanan_id dan amount (>0) wajib" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const xenditKey = Deno.env.get("XENDIT_SECRET_KEY");
    if (!xenditKey) {
      return new Response(
        JSON.stringify({ error: "XENDIT_SECRET_KEY belum di-set di Supabase secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Unique reference per pesanan + timestamp (kalau dibuat ulang)
    const referenceId = `sj-${pesanan_id}-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 menit

    // Panggil Xendit QR Codes API
    const xenditRes = await fetch("https://api.xendit.co/qr_codes", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(xenditKey + ":"),
        "Content-Type": "application/json",
        "api-version": "2022-07-31",
      },
      body: JSON.stringify({
        reference_id: referenceId,
        type: "DYNAMIC",
        currency: "IDR",
        amount: Math.round(Number(amount)),
        expires_at: expiresAt,
      }),
    });

    const xenditData = await xenditRes.json();

    if (!xenditRes.ok) {
      console.error("Xendit error:", xenditData);
      return new Response(
        JSON.stringify({ error: "Xendit API error", detail: xenditData }),
        { status: xenditRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Simpan ke Supabase
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: pembayaran, error: dbErr } = await supa
      .from("pembayaran")
      .insert({
        pesanan_id: pesanan_id,
        xendit_ref: referenceId,
        xendit_qr_string: xenditData.qr_string,
        amount: amount,
        metode: "QRIS",
        status: "PENDING",
        payload: xenditData,
      })
      .select()
      .single();

    if (dbErr) {
      console.error("DB insert error:", dbErr);
      return new Response(
        JSON.stringify({ error: "Gagal simpan pembayaran", detail: dbErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        pembayaran_id: pembayaran.id,
        qr_string: xenditData.qr_string,
        xendit_id: xenditData.id,
        amount: amount,
        expires_at: expiresAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-qris error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
