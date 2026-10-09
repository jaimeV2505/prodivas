import { CONFIG } from "./config";
import { fmtLong, fmtPrice } from "./format";
import type { BookingSummary } from "./bookings";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

async function send(to: string[], subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to.length) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject, html }),
  });
  if (!res.ok) console.error("[notify] Resend", res.status, await res.text());
}

/** Avisa a la dueña y (si dejó email) a la clienta. Nunca lanza: un fallo de email no rompe la reserva. */
export async function notifyBooking(b: BookingSummary, kind: "created" | "cancelled") {
  try {
    const when = fmtLong(b.startsAt);
    const verb = kind === "created" ? "Nueva cita" : "Cita cancelada";
    const owner = process.env.OWNER_EMAIL;
    const rows = `
      <p><strong>${esc(b.serviceName)}</strong> · ${esc(fmtPrice(b.priceCents))}</p>
      <p>${esc(when)}</p>
      <p>${esc(b.customerName ?? "")} · ${esc(b.customerPhone ?? "")}</p>
      ${b.notes ? `<p><em>${esc(b.notes)}</em></p>` : ""}
      <p>Código: ${esc(b.code)}</p>`;

    if (owner) await send([owner], `${verb}: ${b.customerName ?? ""} · ${when}`, `<h2>${verb}</h2>${rows}`);

    if (b.customerEmail) {
      const manage = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/reserva/${b.code}?t=${b.token}`;
      const html =
        kind === "created"
          ? `<h2>¡Cita confirmada en ${CONFIG.salon.name}!</h2>${rows}
             <p>${esc(CONFIG.salon.address)}</p>
             ${process.env.NEXT_PUBLIC_SITE_URL ? `<p><a href="${esc(manage)}">Ver o cancelar mi cita</a></p>` : ""}`
          : `<h2>Tu cita ha sido cancelada</h2>${rows}`;
      await send([b.customerEmail], `${kind === "created" ? "Cita confirmada" : "Cita cancelada"} · ${CONFIG.salon.name}`, html);
    }
  } catch (e) {
    console.error("[notify]", e);
  }
}
