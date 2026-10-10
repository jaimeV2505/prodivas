import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "./db";
import { siteUrl } from "./site";

/** Señal con Stripe Checkout (sin SDK: llamadas REST). Solo se activa si hay claves de Stripe. */
const key = () => process.env.STRIPE_SECRET_KEY ?? "";
export const stripeEnabled = () => !!key() && !!process.env.STRIPE_WEBHOOK_SECRET;
/** Cancelar con al menos estas horas de antelación devuelve la señal. */
export const DEPOSIT_REFUND_HOURS = Number(process.env.DEPOSIT_REFUND_HOURS ?? 24);

type StripeResult = { ok: boolean; json?: Record<string, unknown>; detail?: string };

async function stripePost(path: string, body: URLSearchParams): Promise<StripeResult> {
  try {
    const r = await fetch(`https://api.stripe.com/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(12000),
    });
    const json = (await r.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (r.ok) return { ok: true, json };
    const msg = (json?.error as { message?: string } | undefined)?.message ?? JSON.stringify(json ?? {});
    return { ok: false, json, detail: `${r.status} ${msg}`.slice(0, 240) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error de red" };
  }
}

export async function createCheckoutSession(i: {
  bookingId: string;
  /** Visita en horas distintas: una sola señal que cubre todas las citas del grupo. */
  groupId?: string;
  code: string;
  token: string;
  amountCents: number;
  description: string;
  email?: string | null;
}): Promise<{ id: string; url: string } | { error: string }> {
  const b = new URLSearchParams({
    mode: "payment",
    locale: "es",
    success_url: `${siteUrl()}/c/${i.code}?t=${i.token.slice(0, 12)}&paid=1`,
    cancel_url: `${siteUrl()}/reservar`,
    client_reference_id: i.bookingId,
    "metadata[booking_id]": i.bookingId,
    "payment_intent_data[description]": `Señal · ${i.description}`,
    "payment_intent_data[metadata][booking_id]": i.bookingId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(i.amountCents),
    "line_items[0][price_data][product_data][name]": `Señal · ${i.description}`,
    // Stripe exige que la sesión dure al menos 30 min
    expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
  });
  if (i.groupId) {
    b.set("metadata[group_id]", i.groupId);
    b.set("payment_intent_data[metadata][group_id]", i.groupId);
  }
  if (i.email) b.set("customer_email", i.email);
  const r = await stripePost("/checkout/sessions", b);
  const id = r.json?.id;
  const url = r.json?.url;
  if (!r.ok || typeof id !== "string" || typeof url !== "string") return { error: r.detail ?? "respuesta inesperada de Stripe" };
  return { id, url };
}

/** Sin importe devuelve todo; con importe, solo esa parte (una señal que cubre varias citas se devuelve cita a cita). */
export async function refundPaymentIntent(paymentIntent: string, amountCents?: number): Promise<{ ok: boolean; detail?: string }> {
  const body = new URLSearchParams({ payment_intent: paymentIntent });
  if (amountCents && amountCents > 0) body.set("amount", String(amountCents));
  const r = await stripePost("/refunds", body);
  if (r.ok) return { ok: true };
  const code = (r.json?.error as { code?: string } | undefined)?.code;
  if (code === "charge_already_refunded") return { ok: true };
  return { ok: false, detail: r.detail };
}

/** Comprueba la firma del webhook (cabecera Stripe-Signature) con tolerancia de 5 minutos. */
export function verifyStripeSignature(raw: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/**
 * Qué pasa con la señal cuando la cita se cancela:
 *  - "refund": se devuelve siempre (cancela el centro)
 *  - "policy": se devuelve si faltan al menos DEPOSIT_REFUND_HOURS; si no, se pierde
 *  - "forfeit": se pierde (no vino)
 */
export async function settleDeposit(bookingId: string, mode: "refund" | "policy" | "forfeit"): Promise<"refunded" | "forfeited" | "none" | "failed"> {
  const rows = await query<{ deposit_status: string; pi: string | null; in_time: boolean; cents: number; shared: boolean }>(
    `SELECT deposit_status, stripe_payment_intent AS pi, deposit_cents AS cents, (group_id IS NOT NULL) AS shared,
            (starts_at - now()) >= make_interval(hours => $2::int) AS in_time
     FROM bookings WHERE id = $1::uuid`,
    [bookingId, DEPOSIT_REFUND_HOURS],
  );
  const b = rows[0];
  if (!b || b.deposit_status !== "PAID") return "none";
  const refund = mode === "refund" || (mode === "policy" && b.in_time);
  if (refund) {
    if (!b.pi) return "failed";
    // Si la señal cubría varias citas, solo se devuelve la parte de ESTA cita
    const r = await refundPaymentIntent(b.pi, b.shared ? b.cents : undefined);
    if (!r.ok) {
      console.error("[stripe:refund]", r.detail);
      return "failed";
    }
    await query(`UPDATE bookings SET deposit_status = 'REFUNDED' WHERE id = $1::uuid`, [bookingId]);
    return "refunded";
  }
  await query(`UPDATE bookings SET deposit_status = 'FORFEITED' WHERE id = $1::uuid`, [bookingId]);
  return "forfeited";
}
