import { query } from "./db";
import { phoneDigits } from "./site";

export type Channel = "whatsapp" | "sms" | "email" | "telegram";
export type SendResult = { ok: boolean; detail?: string };

const env = (k: string) => process.env[k] ?? "";

/** Qué canales están configurados (por variables de entorno). */
export const enabled = {
  email: () => !!env("RESEND_API_KEY") && !!env("MAIL_FROM"),
  sms: () => !!env("TWILIO_ACCOUNT_SID") && !!env("TWILIO_AUTH_TOKEN") && !!(env("TWILIO_FROM") || env("TWILIO_MESSAGING_SERVICE_SID")),
  whatsapp: () => !!env("WHATSAPP_TOKEN") && !!env("WHATSAPP_PHONE_NUMBER_ID"),
  telegram: () => !!env("TELEGRAM_BOT_TOKEN") && !!env("TELEGRAM_CHAT_ID"),
};

export async function logSend(bookingId: string | null, kind: string, channel: Channel, r: SendResult) {
  try {
    await query(
      `INSERT INTO notification_log (booking_id, kind, channel, status, detail) VALUES ($1::uuid, $2, $3, $4, $5)`,
      [bookingId, kind, channel, r.ok ? "SENT" : "FAILED", r.detail ? r.detail.slice(0, 300) : null],
    );
  } catch (e) {
    console.error("[notify:log]", e);
  }
}

async function post(url: string, init: RequestInit): Promise<SendResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(9000) });
    if (res.ok) return { ok: true };
    return { ok: false, detail: `${res.status} ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error de red" };
  }
}

export function sendEmail(to: string[], subject: string, html: string): Promise<SendResult> {
  return post("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("MAIL_FROM"), to, subject, html }),
  });
}

export function sendSms(phone: string, body: string): Promise<SendResult> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const form = new URLSearchParams({ To: `+${phoneDigits(phone)}`, Body: body });
  if (env("TWILIO_MESSAGING_SERVICE_SID")) form.set("MessagingServiceSid", env("TWILIO_MESSAGING_SERVICE_SID"));
  else form.set("From", env("TWILIO_FROM"));
  return post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
}

const waUrl = () =>
  `https://graph.facebook.com/${env("WHATSAPP_API_VERSION") || "v23.0"}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`;
const waHeaders = () => ({ Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" });

export type WaButton = { kind: "quick_reply"; payload: string } | { kind: "url"; suffix: string };

/** Plantilla de WhatsApp Business (necesaria para escribir primero a una clienta). */
export function sendWhatsAppTemplate(phone: string, template: string, params: string[], buttons: WaButton[] = []): Promise<SendResult> {
  const components: unknown[] = [
    { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
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
      template: { name: template, language: { code: "es" }, components },
    }),
  });
}

/** Texto libre: solo permitido dentro de las 24 h siguientes a un mensaje de la clienta (p. ej. al responder a un botón). */
export function sendWhatsAppText(phone: string, text: string): Promise<SendResult> {
  return post(waUrl(), {
    method: "POST",
    headers: waHeaders(),
    body: JSON.stringify({ messaging_product: "whatsapp", to: phoneDigits(phone), type: "text", text: { body: text } }),
  });
}

export function sendTelegram(html: string): Promise<SendResult> {
  return post(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env("TELEGRAM_CHAT_ID"), text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}
