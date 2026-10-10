import { query } from "./db";
import { derivedSecret } from "./secrets";
import { phoneDigits, siteUrl } from "./site";

export type Channel = "whatsapp" | "sms" | "email" | "telegram";
export type SendResult = { ok: boolean; detail?: string; providerId?: string };

const env = (k: string) => process.env[k] ?? "";

/** Qué canales están configurados (por variables de entorno). */
export const enabled = {
  email: () => !!env("RESEND_API_KEY") && !!env("MAIL_FROM"),
  sms: () => !!env("TWILIO_ACCOUNT_SID") && !!env("TWILIO_AUTH_TOKEN") && !!(env("TWILIO_FROM") || env("TWILIO_MESSAGING_SERVICE_SID")),
  whatsapp: () => !!env("WHATSAPP_TOKEN") && !!env("WHATSAPP_PHONE_NUMBER_ID"),
  telegram: () => !!env("TELEGRAM_BOT_TOKEN") && !!env("TELEGRAM_CHAT_ID"),
};

export async function logSend(
  bookingId: string | null,
  kind: string,
  channel: Channel,
  r: SendResult,
  extra?: { fallbackSms?: string; fallbackPhone?: string },
) {
  try {
    await query(
      `INSERT INTO notification_log (booking_id, kind, channel, status, detail, provider_id, delivery_status, fallback_sms, fallback_phone)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        bookingId,
        kind,
        channel,
        r.ok ? "SENT" : "FAILED",
        r.detail ? r.detail.slice(0, 300) : null,
        r.providerId ?? null,
        r.ok && (channel === "whatsapp" || channel === "sms") ? "sent" : null,
        extra?.fallbackSms ?? null,
        extra?.fallbackPhone ?? null,
      ],
    );
  } catch (e) {
    console.error("[notify:log]", e);
  }
}

type Json = Record<string, unknown>;

async function post(url: string, init: RequestInit): Promise<SendResult & { json?: Json }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(9000) });
    const text = await res.text();
    let json: Json | undefined;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      /* respuesta sin JSON */
    }
    if (res.ok) return { ok: true, json };
    return { ok: false, detail: `${res.status} ${text.slice(0, 200)}`, json };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error de red" };
  }
}

export function sendEmail(to: string[], subject: string, html: string): Promise<SendResult> {
  return post("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("MAIL_FROM"), to, subject, html }),
  }).then((r) => ({ ok: r.ok, detail: r.detail, providerId: typeof r.json?.id === "string" ? (r.json.id as string) : undefined }));
}

export function sendSms(phone: string, body: string): Promise<SendResult> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const form = new URLSearchParams({ To: `+${phoneDigits(phone)}`, Body: body });
  if (env("TWILIO_MESSAGING_SERVICE_SID")) form.set("MessagingServiceSid", env("TWILIO_MESSAGING_SERVICE_SID"));
  else form.set("From", env("TWILIO_FROM"));
  // Twilio avisa aquí de si el SMS llegó o no (el secreto va en la propia URL)
  if (siteUrl().startsWith("https://")) form.set("StatusCallback", `${siteUrl()}/api/twilio/status?s=${derivedSecret("twilio-status", 24)}`);
  return post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  }).then((r) => ({ ok: r.ok, detail: r.detail, providerId: typeof r.json?.sid === "string" ? (r.json.sid as string) : undefined }));
}

const waUrl = () =>
  `https://graph.facebook.com/${env("WHATSAPP_API_VERSION") || "v23.0"}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`;
const waHeaders = () => ({ Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" });

export type WaButton = { kind: "quick_reply"; payload: string } | { kind: "url"; suffix: string };

function waResult(r: SendResult & { json?: Json }): SendResult {
  const msgs = r.json?.messages as { id?: string }[] | undefined;
  return { ok: r.ok, detail: r.detail, providerId: msgs?.[0]?.id };
}

/** Plantilla de WhatsApp Business (necesaria para escribir primero a una clienta). */
export function sendWhatsAppTemplate(
  phone: string,
  template: string,
  params: string[],
  buttons: WaButton[] = [],
  lang = "es",
): Promise<SendResult> {
  const components: unknown[] = [
    ...(params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : []),
    ...buttons.map((b, index) =>
      b.kind === "quick_reply"
        ? { type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload: b.payload }] }
        : { type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: b.suffix }] },
    ),
  ];
  return post(waUrl(), {
    method: "POST",
    headers: waHeaders(),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phoneDigits(phone),
      type: "template",
      template: { name: template, language: { code: lang }, ...(components.length ? { components } : {}) },
    }),
  }).then(waResult);
}

/** Texto libre: solo permitido dentro de las 24 h siguientes a un mensaje de la clienta (p. ej. al responder a un botón). */
export function sendWhatsAppText(phone: string, text: string): Promise<SendResult> {
  return post(waUrl(), {
    method: "POST",
    headers: waHeaders(),
    body: JSON.stringify({ messaging_product: "whatsapp", to: phoneDigits(phone), type: "text", text: { body: text } }),
  }).then(waResult);
}

export function sendTelegram(html: string): Promise<SendResult> {
  return post(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env("TELEGRAM_CHAT_ID"), text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}
