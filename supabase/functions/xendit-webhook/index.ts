// ================================================================
// Edge Function: xendit-webhook
// ================================================================
// Endpoint penerima callback dari Xendit saat pembayaran QRIS masuk.
//
// Daftarkan URL ini di Xendit Dashboard → Settings → Webhooks:
//   https://YOUR-PROJECT.supabase.co/functions/v1/xendit-webhook
//   Event: QR Payment / qr.payment
//
// Required secret:
//   - XENDIT_WEBHOOK_TOKEN  (dari Xendit Dashboard → Settings → Webhooks
//                            → Webhook Verification Token)
// ================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // 1. Verify Xendit callback token
  const callbackToken = req.headers.get("x-callback-token");
  const expectedToken = Deno.env.get("XENDIT_WEBHOOK_TOKEN");

  if (!expectedToken) {
    console.error("XENDIT_WEBHOOK_TOKEN belum di-set");
    return new Response("Webhook token not configured", { status: 500 });
  }

  if (callbackToken !== expectedToken) {
    console.warn("Invalid callback token:", callbackToken);
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse payload
  let event;
  try {
    event = await req.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log("Xendit webhook event:", JSON.stringify(event));

  // Xendit QR payment event structure (v1):
  //   event: "qr.payment"
  //   data: { id, qr_id, reference_id, amount, status, channel_code, ... }
  //
  // Or direct format (lebih lawas):
  //   { id, qr_id, reference_id, amount, status, ... }
  //
  // Handle keduanya
  const data = event.data || event;
  const status = data.status;
  const referenceId = data.reference_id;
  const xenditPaymentId = data.id;

  if (!referenceId) {
    console.error("Missing reference_id in webhook payload");
    return new Response("Missing reference_id", { status: 400 });
  }

  // 3. Update Supabase
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  );

  // Tentukan status final
  let finalStatus = "PENDING";
  if (status === "SUCCEEDED" || status === "PAID" || status === "ACTIVE_PAID") {
    finalStatus = "LUNAS";
  } else if (status === "EXPIRED") {
    finalStatus = "EXPIRED";
  } else if (status === "FAILED") {
    finalStatus = "GAGAL";
  }

  // Update pembayaran berdasarkan reference_id
  const { data: pembayaran, error: updErr } = await supa
    .from("pembayaran")
    .update({
      status: finalStatus,
      payload: event,
    })
    .eq("xendit_ref", referenceId)
    .select()
    .single();

  if (updErr) {
    console.error("Update pembayaran error:", updErr);
    return new Response("DB update failed", { status: 500 });
  }

  // Update pesanan kalau LUNAS — set metode_bayar = QRIS
  if (finalStatus === "LUNAS" && pembayaran) {
    await supa.from("pesanan")
      .update({ metode_bayar: "QRIS" })
      .eq("id", pembayaran.pesanan_id);
  }

  return new Response(
    JSON.stringify({ ok: true, status: finalStatus }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
