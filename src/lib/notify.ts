import { CONFIG } from "./config";
import { todayIn, addDays } from "./dates";
import { fmtLong, fmtPrice } from "./format";
import type { BookingSummary } from "./bookings";
import { enabled, logSend, sendEmail, sendSms, sendTelegram, sendWhatsAppTemplate, type Channel, type SendResult } from "./messaging";
import { gsm, manageLink, siteUrl } from "./site";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CONFIG.tz }).format(new Date(iso));

/** "hoy a las 17:00" / "mañana a las 09:30" / "Viernes 16 de octubre, 10:00" */
export function whenWords(iso: string): string {
  const today = todayIn(CONFIG.tz);
  const day = todayIn(CONFIG.tz, new Date(iso));
  if (day === today) return `hoy a las ${hhmm(iso)}`;
  if (day === addDays(today, 1)) return `mañana a las ${hhmm(iso)}`;
  return fmtLong(iso);
}

async function run(
  bookingId: string | null,
  kind: string,
  channel: Channel,
  send: () => Promise<SendResult>,
  extra?: { fallbackSms?: string; fallbackPhone?: string },
): Promise<boolean> {
  const r = await send();
  await logSend(bookingId, kind, channel, r, extra);
  return r.ok;
}

/* ------------------------------------------------------------------ */
/* A la clienta: WhatsApp (si hay) → SMS como respaldo → email si lo dejó */
/* ------------------------------------------------------------------ */

type Person = { bookingId: string | null; phone: string | null; email: string | null };
type Msg = {
  sms: string;
  wa?: { template: string; params: string[]; buttons: Parameters<typeof sendWhatsAppTemplate>[3] };
  email: { subject: string; html: string };
};

async function toPerson(p: Person, kind: string, msg: Msg): Promise<boolean> {
  let ok = false;
  let waOk = false;
  if (p.phone && msg.wa && enabled.whatsapp()) {
    waOk = await run(
      p.bookingId,
      kind,
      "whatsapp",
      () => sendWhatsAppTemplate(p.phone!, msg.wa!.template, msg.wa!.params, msg.wa!.buttons),
      { fallbackSms: gsm(msg.sms), fallbackPhone: p.phone },
    );
    ok = ok || waOk;
  }
  if (p.phone && !waOk && enabled.sms()) {
    ok = (await run(p.bookingId, kind, "sms", () => sendSms(p.phone!, gsm(msg.sms)))) || ok;
  }
  if (p.email && enabled.email()) {
    ok = (await run(p.bookingId, kind, "email", () => sendEmail([p.email!], msg.email.subject, msg.email.html))) || ok;
  }
  return ok;
}

const toCustomer = (b: BookingSummary, kind: string, msg: Msg) =>
  toPerson({ bookingId: b.id, phone: b.customerPhone, email: b.customerEmail }, kind, msg);

function mailShell(title: string, body: string, buttons: { label: string; href: string; primary?: boolean }[] = []): string {
  const btn = buttons
    .map(
      (x) =>
        `<a href="${esc(x.href)}" style="display:inline-block;margin:6px 8px 6px 0;padding:14px 22px;border-radius:999px;font-weight:700;text-decoration:none;${
          x.primary ? "background:#b0206a;color:#fff" : "border:2px solid #b0206a;color:#b0206a"
        }">${esc(x.label)}</a>`,
    )
    .join("");
  return `<div style="font-family:system-ui,sans-serif;font-size:17px;line-height:1.5;color:#3a1230;max-width:520px">
    <h2 style="color:#b0206a">${esc(title)}</h2>${body}<p>${btn}</p>
    <p style="color:#6b4a60;font-size:14px">${esc(CONFIG.salon.address)}<br>Tel. ${esc(CONFIG.salon.phoneMobile)}</p></div>`;
}

export async function notifyBookingCreated(b: BookingSummary): Promise<void> {
  const link = manageLink(b.code, b.token);
  const when = fmtLong(b.startsAt);
  await Promise.all([
    toCustomer(b, "created", {
      sms: `Pro Diva: cita confirmada. ${b.serviceName}, ${when}. Si no puedes venir, avisanos aqui: ${link}`,
      wa: {
        template: process.env.WA_TEMPLATE_CREATED || "cita_confirmada",
        params: [b.customerName ?? "", b.serviceName, when],
        buttons: [{ kind: "url", suffix: `${b.code}?t=${b.token.slice(0, 12)}` }],
      },
      email: {
        subject: `Cita confirmada en ${CONFIG.salon.name}`,
        html: mailShell(
          "¡Tu cita está confirmada!",
          `<p>Hola ${esc(b.customerName ?? "")}, te esperamos:</p><p><b>${esc(b.serviceName)}</b><br>${esc(when)}</p><p>El mismo día te escribiremos para que confirmes que vienes.</p>`,
          [{ label: "Ver o cancelar mi cita", href: link, primary: true }],
        ),
      },
    }),
    toOwner(
      b,
      "owner_new",
      `<b>Nueva cita</b>\n${esc(b.serviceName)}\n${esc(when)}\n${esc(b.customerName ?? "")}, ${esc(b.customerPhone ?? "")}${
        b.depositStatus === "PAID" ? `\n💳 Señal pagada: ${esc(fmtPrice(b.depositCents))}` : ""
      }${b.notes ? `\n<i>${esc(b.notes)}</i>` : ""}`,
      `Nueva cita: ${b.customerName ?? ""}, ${when}`,
    ),
  ]);
}

/** Recordatorio con "Confirmar" y "Cancelar". Devuelve true si salió por algún canal. */
/** Visita en horas distintas: un solo aviso a la clienta (y uno a la dueña) con todas las citas. */
export async function notifyGroupCreated(list: BookingSummary[]): Promise<void> {
  if (list.length === 0) return;
  if (list.length === 1) return notifyBookingCreated(list[0]);
  const first = list[0];
  const link = manageLink(first.code, first.token);
  const lines = list.map((b) => `${b.serviceName}: ${fmtLong(b.startsAt)}`);
  const total = list.reduce((a, b) => a + b.priceCents, 0);
  await Promise.all([
    toCustomer(first, "created", {
      sms: `Pro Diva: ${list.length} citas confirmadas. ${lines.join("; ")}. Gestionalas aqui: ${link}`,
      wa: {
        template: process.env.WA_TEMPLATE_CREATED || "cita_confirmada",
        params: [first.customerName ?? "", list.map((b) => b.serviceName).join(" + "), list.map((b) => fmtLong(b.startsAt)).join(" · ")],
        buttons: [{ kind: "url", suffix: `${first.code}?t=${first.token.slice(0, 12)}` }],
      },
      email: {
        subject: `Tus ${list.length} citas en ${CONFIG.salon.name}`,
        html: mailShell(
          "¡Tus citas están confirmadas!",
          `<p>Hola ${esc(first.customerName ?? "")}, te esperamos:</p><ul>${list.map((b) => `<li><b>${esc(b.serviceName)}</b> · ${esc(fmtLong(b.startsAt))}</li>`).join("")}</ul><p>El mismo día de cada cita te escribiremos para que confirmes que vienes.</p>`,
          [{ label: "Ver o cancelar mis citas", href: link, primary: true }],
        ),
      },
    }),
    toOwner(
      first,
      "owner_new",
      `<b>Nueva visita en ${list.length} horas distintas</b>\n${list.map((b) => `• ${esc(b.serviceName)}: ${esc(fmtLong(b.startsAt))}`).join("\n")}\n${esc(first.customerName ?? "")}, ${esc(first.customerPhone ?? "")} · ${esc(fmtPrice(total))}${
        first.depositStatus === "PAID" ? "\n💳 Señal pagada" : ""
      }${first.notes ? `\n<i>${esc(first.notes)}</i>` : ""}`,
      `Nueva visita (${list.length} citas): ${first.customerName ?? ""}`,
    ),
  ]);
}

export async function notifyReminder(b: BookingSummary): Promise<boolean> {
  const link = manageLink(b.code, b.token);
  const words = whenWords(b.startsAt);
  const name = b.customerName ?? "";
  return toCustomer(b, "reminder", {
    sms: `Pro Diva: te esperamos ${words} (${b.serviceName}). Confirma o cancela con un toque: ${link}`,
    wa: {
      template: process.env.WA_TEMPLATE_REMINDER || "recordatorio_cita",
      params: [name, b.serviceName, words],
      buttons: [
        { kind: "quick_reply", payload: `C:${b.code}` },
        { kind: "quick_reply", payload: `X:${b.code}` },
      ],
    },
    email: {
      subject: `¿Vienes ${words}? · ${CONFIG.salon.name}`,
      html: mailShell(
        `¿Vienes ${words}?`,
        `<p>Hola ${esc(name)}, te recordamos tu cita de <b>${esc(b.serviceName)}</b>.</p><p>Si no puedes venir, cancela con un toque: así otra persona podrá aprovechar el hueco.</p>`,
        [
          { label: "Confirmo, voy", href: link, primary: true },
          { label: "No puedo ir", href: link },
        ],
      ),
    },
  });
}

export async function notifyCancelledByCentre(b: BookingSummary): Promise<void> {
  const when = fmtLong(b.startsAt);
  await toCustomer(b, "cancelled_by_centre", {
    sms: `Pro Diva: tu cita del ${when} ha sido cancelada. Llamanos al ${CONFIG.salon.phoneMobile} para darte otra. Disculpa las molestias.`,
    email: {
      subject: `Tu cita ha sido cancelada · ${CONFIG.salon.name}`,
      html: mailShell("Tu cita ha sido cancelada", `<p>Tu cita de <b>${esc(b.serviceName)}</b> (${esc(when)}) ha sido cancelada por el centro. Llámanos y te damos otra.</p>`, [
        { label: "Reservar otra cita", href: `${siteUrl()}/cita`, primary: true },
      ]),
    },
  });
}

/* ------------------------------------------------------------------ */
/* A la dueña: Telegram (instantáneo) + email                           */
/* ------------------------------------------------------------------ */

async function toOwner(b: BookingSummary | null, kind: string, html: string, subject: string): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (enabled.telegram()) jobs.push(run(b?.id ?? null, kind, "telegram", () => sendTelegram(html)));
  const owner = process.env.OWNER_EMAIL;
  if (owner && enabled.email()) {
    jobs.push(run(b?.id ?? null, kind, "email", () => sendEmail([owner], subject, `<div style="font-family:system-ui,sans-serif;white-space:pre-line">${html.replace(/<\/?b>/g, "").replace(/<\/?i>/g, "")}</div>`)));
  }
  await Promise.all(jobs);
}

export async function notifyOwnerResponse(b: BookingSummary, state: "confirmed" | "cancelled"): Promise<void> {
  const when = whenWords(b.startsAt);
  if (state === "confirmed") {
    await toOwner(b, "owner_confirmed", `✅ <b>${esc(b.customerName ?? "")}</b> confirma su cita (${esc(when)}, ${esc(b.serviceName)}).`, `Confirmada: ${b.customerName ?? ""}`);
    return;
  }
  await toOwner(
    b,
    "owner_cancelled",
    `⚠️ <b>Hueco libre ${esc(when)}</b>\n${esc(b.customerName ?? "")} cancela ${esc(b.serviceName)} (${Math.round((new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 60000)} min).\nPuedes ofrecérselo a alguien: ${siteUrl()}/reservar`,
    `Hueco libre ${when}`,
  );
}

export async function notifyOwnerCancelledOnline(b: BookingSummary): Promise<void> {
  await notifyOwnerResponse(b, "cancelled");
}

export async function notifyOwnerUnconfirmed(b: BookingSummary): Promise<void> {
  await toOwner(
    b,
    "owner_unconfirmed",
    `📞 <b>Sin respuesta</b>: ${esc(b.customerName ?? "")} no ha confirmado su cita (${esc(whenWords(b.startsAt))}, ${esc(b.serviceName)}).\nLlámala: ${esc(b.customerPhone ?? "")}`,
    `Sin respuesta: ${b.customerName ?? ""}`,
  );
}


/* ------------------------------------------------------------------ */
/* Lista de espera                                                     */
/* ------------------------------------------------------------------ */

export type WaitPerson = { id: string; name: string; phone: string; email: string | null; serviceName: string };

/** Aviso a quien esperaba: se ha liberado un hueco. Devuelve true si salió por algún canal. */
export async function notifyWaitlistSlot(w: WaitPerson, slotIso: string): Promise<boolean> {
  const link = `${siteUrl()}/hueco/${w.id}`;
  const words = whenWords(slotIso);
  return toPerson({ bookingId: null, phone: w.phone, email: w.email }, "waitlist", {
    sms: `Pro Diva: se ha liberado un hueco para ${w.serviceName}, ${words}. Reservalo antes de que se ocupe: ${link}`,
    wa: {
      template: process.env.WA_TEMPLATE_WAITLIST || "hueco_libre",
      params: [w.name, w.serviceName, words],
      buttons: [{ kind: "url", suffix: w.id }],
    },
    email: {
      subject: `Se ha liberado un hueco · ${CONFIG.salon.name}`,
      html: mailShell("¡Se ha liberado un hueco!", `<p>Hola ${esc(w.name)}, ahora hay hueco para <b>${esc(w.serviceName)}</b>: ${esc(words)}.</p><p>Quien llegue primero se lo queda.</p>`, [
        { label: "Reservar ahora", href: link, primary: true },
      ]),
    },
  });
}

export async function notifyOwnerWaitlistJoined(w: { name: string; phone: string; serviceName: string; dayLabel: string }): Promise<void> {
  await toOwner(
    null,
    "owner_waitlist",
    `📝 <b>Lista de espera</b>: ${esc(w.name)} (${esc(w.phone)}) quiere ${esc(w.serviceName)}, ${esc(w.dayLabel)}.`,
    `Lista de espera: ${w.name}`,
  );
}

export async function notifyOwnerWaitlistOffered(b: BookingSummary, count: number): Promise<void> {
  await toOwner(
    b,
    "owner_waitlist_offered",
    `📣 Hueco de ${esc(whenWords(b.startsAt))} liberado: he avisado a <b>${count}</b> ${count === 1 ? "persona" : "personas"} de la lista de espera.`,
    `Avisadas ${count} de la lista de espera`,
  );
}

export async function notifyOwnerCallback(c: { name: string; phone: string }): Promise<void> {
  await toOwner(null, "owner_callback", `📞 <b>Quiere que la llames</b>: ${esc(c.name)}, ${esc(c.phone)}`, `Llámala: ${c.name}`);
}


/* ------------------------------------------------------------------ */
/* Cambio de hora, plantones y avisos libres a la dueña                */
/* ------------------------------------------------------------------ */

export async function notifyRescheduled(b: BookingSummary, oldStartsAt: string, notifyCustomer = true): Promise<void> {
  const link = manageLink(b.code, b.token);
  const when = fmtLong(b.startsAt);
  const jobs: Promise<unknown>[] = [];
  if (notifyCustomer) {
    jobs.push(
      toCustomer(b, "rescheduled", {
        sms: `Pro Diva: tu cita ha cambiado a ${when} (${b.serviceName}). Si no te viene bien: ${link}`,
        wa: {
          // se reutiliza la plantilla de confirmación con la nueva fecha
          template: process.env.WA_TEMPLATE_CREATED || "cita_confirmada",
          params: [b.customerName ?? "", b.serviceName, when],
          buttons: [{ kind: "url", suffix: `${b.code}?t=${b.token.slice(0, 12)}` }],
        },
        email: {
          subject: `Tu cita ha cambiado · ${CONFIG.salon.name}`,
          html: mailShell("Tu cita ha cambiado de hora", `<p>Tu cita de <b>${esc(b.serviceName)}</b> es ahora:</p><p><b>${esc(when)}</b></p>`, [
            { label: "Ver o cambiar mi cita", href: link, primary: true },
          ]),
        },
      }),
    );
  }
  jobs.push(
    toOwner(
      b,
      "owner_rescheduled",
      `🔁 <b>${esc(b.customerName ?? "")}</b> cambia su cita (${esc(b.serviceName)})\nDe: ${esc(fmtLong(oldStartsAt))}\nA: ${esc(when)}`,
      `Cita cambiada: ${b.customerName ?? ""}`,
    ),
  );
  await Promise.all(jobs);
}

export async function notifyOwnerRepeatOffender(b: BookingSummary, count: number): Promise<void> {
  await toOwner(
    b,
    "owner_repeat_offender",
    `⚠️ <b>${esc(b.customerName ?? "")}</b> lleva <b>${count}</b> ${count === 1 ? "plantón" : "plantones"} y acaba de reservar (${esc(fmtLong(b.startsAt))}, ${esc(b.serviceName)}).\nQuizá te interese confirmarla por teléfono: ${esc(b.customerPhone ?? "")}`,
    `Clienta con plantones: ${b.customerName ?? ""}`,
  );
}

/** Aviso libre a la dueña (Telegram y, si hay, email). */
export async function notifyOwnerRaw(html: string, subject: string, bookingId: string | null = null): Promise<void> {
  const fake = bookingId ? ({ id: bookingId } as BookingSummary) : null;
  await toOwner(fake, "owner_raw", html, subject);
}
