import { CONFIG } from "./config";
import { todayIn, addDays } from "./dates";
import { fmtLong, fmtPrice } from "./format";
import { fill, LOCALE, type Lang } from "./i18n";
import { msgDict, type MsgDict } from "./i18n/msg";
import type { BookingSummary } from "./bookings";
import { enabled, logSend, sendEmail, sendSms, sendTelegram, sendWhatsAppTemplate, type Channel, type SendResult } from "./messaging";
import { gsm, manageLink, siteUrl } from "./site";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CONFIG.tz }).format(new Date(iso));

/** "hoy a las 17:00" / "mañana a las 09:30" / "Viernes 16 de octubre, 10:00" (también en gallego e inglés) */
export function whenWords(iso: string, lang: Lang = "es"): string {
  const m = msgDict(lang);
  const today = todayIn(CONFIG.tz);
  const day = todayIn(CONFIG.tz, new Date(iso));
  if (day === today) return fill(m.whenToday, { time: hhmm(iso) });
  if (day === addDays(today, 1)) return fill(m.whenTomorrow, { time: hhmm(iso) });
  return fmtLong(iso, LOCALE[lang]);
}

const langOf = (b: { lang?: string | null }): Lang => (b.lang === "gl" || b.lang === "en" ? b.lang : "es");
const T = (b: { lang?: string | null }): MsgDict => msgDict(langOf(b));
const salon = () => CONFIG.salon.name;

/**
 * Plantilla de WhatsApp en el idioma de la clienta. En castellano se usa la configurada (o la de por defecto);
 * en gallego e inglés solo si has aprobado y configurado la plantilla de ese idioma (WA_TEMPLATE_X_GL / _EN).
 * Si no, no se manda por WhatsApp y salen el SMS y el email, que sí van en su idioma.
 */
const WA_CODE: Record<Lang, string> = { es: process.env.WA_LANG_ES || "es", gl: process.env.WA_LANG_GL || "gl", en: process.env.WA_LANG_EN || "en" };
function waIn(lang: Lang, envBase: string, def: string | null, params: string[], buttons: Parameters<typeof sendWhatsAppTemplate>[3]): Msg["wa"] {
  const template = lang === "es" ? process.env[envBase] || def : process.env[`${envBase}_${lang.toUpperCase()}`] || null;
  return template ? { template, params, buttons, lang: WA_CODE[lang] } : undefined;
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
  wa?: { template: string; params: string[]; buttons: Parameters<typeof sendWhatsAppTemplate>[3]; lang?: string };
  email: { subject: string; html: string };
};

async function toPerson(p: Person, kind: string, msg: Msg, opts: { optional?: boolean } = {}): Promise<boolean> {
  let ok = false;
  let waOk = false;
  if (p.phone && msg.wa && enabled.whatsapp()) {
    waOk = await run(
      p.bookingId,
      kind,
      "whatsapp",
      () => sendWhatsAppTemplate(p.phone!, msg.wa!.template, msg.wa!.params, msg.wa!.buttons, msg.wa!.lang),
      { fallbackSms: gsm(msg.sms), fallbackPhone: p.phone },
    );
    ok = ok || waOk;
  }
  if (p.phone && !waOk && enabled.sms() && (!opts.optional || process.env.OPTIONAL_SMS === "on")) {
    ok = (await run(p.bookingId, kind, "sms", () => sendSms(p.phone!, gsm(msg.sms)))) || ok;
  }
  if (p.email && enabled.email()) {
    ok = (await run(p.bookingId, kind, "email", () => sendEmail([p.email!], msg.email.subject, msg.email.html))) || ok;
  }
  return ok;
}

const toCustomer = (b: BookingSummary, kind: string, msg: Msg, opts: { optional?: boolean } = {}) =>
  toPerson({ bookingId: b.id, phone: b.customerPhone, email: b.customerEmail }, kind, msg, opts);

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
  const when = fmtLong(b.startsAt, LOCALE[langOf(b)]);
  const m = T(b);
  const lang = langOf(b);
  await Promise.all([
    toCustomer(b, "created", {
      sms: fill(m.createdSms, { service: b.serviceName, when, link }),
      wa: waIn(lang, "WA_TEMPLATE_CREATED", "cita_confirmada", [b.customerName ?? "", b.serviceName, when], [{ kind: "url", suffix: `${b.code}?t=${b.token.slice(0, 12)}` }]),
      email: {
        subject: fill(m.createdSubject, { salon: salon() }),
        html: mailShell(
          m.createdTitle,
          `<p>${esc(fill(m.createdHello, { name: b.customerName ?? "" }))}</p><p><b>${esc(b.serviceName)}</b><br>${esc(when)}</p><p>${esc(m.createdNote)}</p>`,
          [{ label: m.createdButton, href: link, primary: true }],
        ),
      },
    }),
    toOwner(
      b,
      "owner_new",
      `<b>Nueva cita</b>\n${esc(b.serviceName)}\n${esc(fmtLong(b.startsAt))}\n${esc(b.customerName ?? "")}, ${esc(b.customerPhone ?? "")}${
        b.lang && b.lang !== "es" ? `\n🌍 Idioma: ${b.lang === "gl" ? "gallego" : "inglés"}` : ""
      }${b.depositStatus === "PAID" ? `\n💳 Señal pagada: ${esc(fmtPrice(b.depositCents))}` : ""}${b.notes ? `\n<i>${esc(b.notes)}</i>` : ""}`,
      `Nueva cita: ${b.customerName ?? ""}, ${fmtLong(b.startsAt)}`,
    ),
  ]);
}

/** Recordatorio con "Confirmar" y "Cancelar". Devuelve true si salió por algún canal. */
/** Visita en horas distintas: un solo aviso a la clienta (y uno a la dueña) con todas las citas. */
export async function notifyGroupCreated(list: BookingSummary[]): Promise<void> {
  if (list.length === 0) return;
  if (list.length === 1) return notifyBookingCreated(list[0]);
  const first = list[0];
  const lang = langOf(first);
  const m = T(first);
  const link = manageLink(first.code, first.token);
  const lines = list.map((b) => `${b.serviceName}: ${fmtLong(b.startsAt, LOCALE[lang])}`);
  const total = list.reduce((a, b) => a + b.priceCents, 0);
  await Promise.all([
    toCustomer(first, "created", {
      sms: fill(m.groupSms, { n: list.length, lines: lines.join("; "), link }),
      wa: waIn(lang, "WA_TEMPLATE_CREATED", "cita_confirmada", [first.customerName ?? "", list.map((b) => b.serviceName).join(" + "), list.map((b) => fmtLong(b.startsAt, LOCALE[lang])).join(" · ")], [{ kind: "url", suffix: `${first.code}?t=${first.token.slice(0, 12)}` }]),
      email: {
        subject: fill(m.groupSubject, { n: list.length, salon: salon() }),
        html: mailShell(
          m.groupTitle,
          `<p>${esc(fill(m.createdHello, { name: first.customerName ?? "" }))}</p><ul>${list.map((b) => `<li><b>${esc(b.serviceName)}</b> · ${esc(fmtLong(b.startsAt, LOCALE[lang]))}</li>`).join("")}</ul><p>${esc(m.groupNote)}</p>`,
          [{ label: m.groupButton, href: link, primary: true }],
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

/**
 * Recordatorio con «Confirmo» y «No puedo ir». Tres momentos:
 *  - "evening": la víspera por la tarde («mañana a las 10:00»);
 *  - "final": unas horas antes (si la clienta ya confirmó la víspera, no se manda);
 *  - "second": unas horas antes, cuando la víspera no contestó («seguimos sin saber si vienes»).
 * Devuelve true si salió por algún canal.
 */
export async function notifyReminder(b: BookingSummary, step: "evening" | "final" | "second" = "final"): Promise<boolean> {
  const lang = langOf(b);
  const m = T(b);
  const link = manageLink(b.code, b.token);
  const words = whenWords(b.startsAt, lang);
  const name = b.customerName ?? "";
  const second = step === "second";
  return toCustomer(b, step === "evening" ? "reminder_evening" : second ? "reminder_second" : "reminder", {
    sms: fill(second ? m.remSms2 : m.remSms, { words, service: b.serviceName, link }),
    wa: waIn(lang, "WA_TEMPLATE_REMINDER", "recordatorio_cita", [name, b.serviceName, words], [
      { kind: "quick_reply", payload: `C:${b.code}` },
      { kind: "quick_reply", payload: `X:${b.code}` },
    ]),
    email: {
      subject: fill(m.remSubject, { words, salon: salon() }),
      html: mailShell(
        fill(m.remTitle, { words }),
        `<p>${esc(fill(second ? m.remBody2 : m.remBody, { name, service: b.serviceName }))}</p><p>${esc(m.remTip)}</p>`,
        [
          { label: m.remYes, href: link, primary: true },
          { label: m.remNo, href: link },
        ],
      ),
    },
  });
}

/** «Cerrar el día»: avisa a cada clienta de que hay que mover su cita, con un enlace para elegir otra hora o cancelar sin coste. */
export async function notifyDayClosed(b: BookingSummary, note: string | null): Promise<void> {
  const lang = langOf(b);
  const m = T(b);
  const when = fmtLong(b.startsAt, LOCALE[lang]);
  const link = manageLink(b.code, b.token);
  await toCustomer(b, "cancelled_by_centre", {
    sms: fill(m.closedSms, { when, note: note ? ` ${note}` : "", link }),
    wa: waIn(lang, "WA_TEMPLATE_CLOSED", null, [b.customerName ?? "", when], [{ kind: "url", suffix: `${b.code}?t=${b.token.slice(0, 12)}` }]),
    email: {
      subject: fill(m.closedSubject, { salon: salon() }),
      html: mailShell(
        m.closedTitle,
        `<p>${esc(fill(m.closedBody, { name: b.customerName ?? "", service: b.serviceName, when }))}${note ? ` ${esc(note)}` : ""}</p><p>${esc(m.closedBody2)}</p>`,
        [{ label: m.closedButton, href: link, primary: true }],
      ),
    },
  });
}

export async function notifyCancelledByCentre(b: BookingSummary): Promise<void> {
  const m = T(b);
  const when = fmtLong(b.startsAt, LOCALE[langOf(b)]);
  await toCustomer(b, "cancelled_by_centre", {
    sms: fill(m.centreSms, { when, phone: CONFIG.salon.phoneMobile }),
    email: {
      subject: fill(m.centreSubject, { salon: salon() }),
      html: mailShell(m.centreTitle, `<p>${esc(fill(m.centreBody, { service: b.serviceName, when }))}</p>`, [{ label: m.centreButton, href: `${siteUrl()}/cita`, primary: true }]),
    },
  });
}

/**
 * Después de la visita: gracias + cuidados + «¿qué tal ha ido?» (valoración privada primero). Es un mensaje opcional:
 * respeta la baja de la clienta y por SMS solo sale si activas OPTIONAL_SMS=on.
 */
export async function notifyAftercare(b: BookingSummary, care: string | null, optout: string): Promise<boolean> {
  const lang = langOf(b);
  const m = T(b);
  const link = `${siteUrl()}/c/${b.code}/valora?t=${b.token}`;
  const name = b.customerName ?? "";
  return toCustomer(
    b,
    "aftercare",
    {
      sms: fill(m.afterSms, { name, care: care ? `${care.slice(0, 140)} ` : "", link }) + ` ${fill(m.optoutSms, { link: optout })}`,
      wa: waIn(lang, "WA_TEMPLATE_AFTERCARE", null, [name, b.serviceName], [{ kind: "url", suffix: `${b.code}?t=${b.token.slice(0, 12)}` }]),
      email: {
        subject: fill(m.afterSubject, { salon: salon() }),
        html:
          mailShell(
            m.afterTitle,
            `<p>${esc(fill(m.afterBody, { name, service: b.serviceName }))}</p>${care ? `<p><b>${esc(m.afterCareTitle)}</b><br>${esc(care)}</p>` : ""}<p>${esc(m.afterAsk)}</p>`,
            [{ label: m.afterButton, href: link, primary: true }],
          ) + `<p style="font-size:13px;color:#6b4a60">${esc(fill(m.optoutLine, { link: optout }))}</p>`,
      },
    },
    { optional: true },
  );
}

/** «Toca retoque»: unos días antes de que se cumplan las semanas del servicio. Mensaje opcional (con baja). */
export async function notifyRebookNudge(b: BookingSummary, serviceName: string, weeks: number, optout: string): Promise<boolean> {
  const lang = langOf(b);
  const m = T(b);
  const link = `${siteUrl()}/reservar?lang=${lang}`;
  const name = b.customerName ?? "";
  return toCustomer(
    b,
    "rebook_nudge",
    {
      sms: fill(m.rtSms, { weeks, service: serviceName, link }) + ` ${fill(m.optoutSms, { link: optout })}`,
      wa: waIn(lang, "WA_TEMPLATE_RETOQUE", null, [name, serviceName, String(weeks)], []),
      email: {
        subject: fill(m.rtSubject, { service: serviceName, salon: salon() }),
        html:
          mailShell(m.rtTitle, `<p>${esc(fill(m.rtBody, { name, weeks, service: serviceName }))}</p>`, [{ label: m.rtButton, href: link, primary: true }]) +
          `<p style="font-size:13px;color:#6b4a60">${esc(fill(m.optoutLine, { link: optout }))}</p>`,
      },
    },
    { optional: true },
  );
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
  const WHY: Record<string, string> = { sick: "enfermedad", work: "trabajo o familia", other: "otro motivo" };
  const late = (b.cancelReason ?? "").endsWith("_late");
  await toOwner(
    b,
    "owner_cancelled",
    `⚠️ <b>Hueco libre ${esc(when)}</b>\n${esc(b.customerName ?? "")} cancela ${esc(b.serviceName)} (${Math.round((new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime()) / 60000)} min).${
      b.cancelWhy ? `\nMotivo: ${WHY[b.cancelWhy] ?? b.cancelWhy}.` : ""
    }${late ? `\n⏱️ Cancela con menos de ${b.noticeHours} h de antelación${b.depositStatus === "FORFEITED" ? ": la señal se retiene" : ""}.` : ""}\nPuedes ofrecérselo a alguien: ${siteUrl()}/reservar`,
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

export type WaitPerson = { id: string; name: string; phone: string; email: string | null; serviceName: string; lang?: string };

/** Aviso a quien esperaba: se ha liberado un hueco. Devuelve true si salió por algún canal. */
export async function notifyWaitlistSlot(w: WaitPerson, slotIso: string): Promise<boolean> {
  const lang = langOf(w);
  const m = T(w);
  const link = `${siteUrl()}/hueco/${w.id}`;
  const words = whenWords(slotIso, lang);
  return toPerson({ bookingId: null, phone: w.phone, email: w.email }, "waitlist", {
    sms: fill(m.wlSms, { service: w.serviceName, words, link }),
    wa: waIn(lang, "WA_TEMPLATE_WAITLIST", "hueco_libre", [w.name, w.serviceName, words], [{ kind: "url", suffix: w.id }]),
    email: {
      subject: fill(m.wlSubject, { salon: salon() }),
      html: mailShell(m.wlTitle, `<p>${esc(fill(m.wlBody, { name: w.name, service: w.serviceName, words }))}</p><p>${esc(m.wlNote)}</p>`, [{ label: m.wlButton, href: link, primary: true }]),
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

export async function notifyRescheduled(b: BookingSummary, oldStartsAt: string, notifyCustomer = true, ownerText?: string): Promise<void> {
  const link = manageLink(b.code, b.token);
  const when = fmtLong(b.startsAt);
  const jobs: Promise<unknown>[] = [];
  if (notifyCustomer) {
    jobs.push(
      toCustomer(b, "rescheduled", {
        sms: fill(T(b).reSms, { when: fmtLong(b.startsAt, LOCALE[langOf(b)]), service: b.serviceName, link }),
        // se reutiliza la plantilla de confirmación con la nueva fecha
        wa: waIn(langOf(b), "WA_TEMPLATE_CREATED", "cita_confirmada", [b.customerName ?? "", b.serviceName, fmtLong(b.startsAt, LOCALE[langOf(b)])], [{ kind: "url", suffix: `${b.code}?t=${b.token.slice(0, 12)}` }]),
        email: {
          subject: fill(T(b).reSubject, { salon: salon() }),
          html: mailShell(T(b).reTitle, `<p>${esc(fill(T(b).reBody, { service: b.serviceName }))}</p><p><b>${esc(fmtLong(b.startsAt, LOCALE[langOf(b)]))}</b></p>`, [{ label: T(b).reButton, href: link, primary: true }]),
        },
      }),
    );
  }
  jobs.push(
    toOwner(
      b,
      "owner_rescheduled",
      ownerText ?? `🔁 <b>${esc(b.customerName ?? "")}</b> cambia su cita (${esc(b.serviceName)})\nDe: ${esc(fmtLong(oldStartsAt))}\nA: ${esc(when)}`,
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

/** Valoración recibida: una mala (≤3) se avisa al momento para que la dueña pueda hablar con la clienta. */
export async function notifyOwnerReview(b: BookingSummary, rating: number, comment: string | null): Promise<void> {
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const bad = rating <= 3;
  await toOwner(
    b,
    bad ? "owner_review_bad" : "owner_review",
    `${bad ? "⚠️" : "⭐"} <b>Valoración ${stars}</b> de ${esc(b.customerName ?? "")} (${esc(b.serviceName)}, ${esc(fmtLong(b.startsAt))})${comment ? `\n<i>${esc(comment)}</i>` : ""}${bad ? `\nQuizá quieras escribirle: ${esc(b.customerPhone ?? "")}` : ""}`,
    `${bad ? "Valoración baja" : "Valoración"}: ${b.customerName ?? ""} ${stars}`,
  );
}
