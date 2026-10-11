import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { logout } from "../actions";
import { isAdmin } from "@/lib/auth";
import { getSlotMode, SLOT_MODES, type SlotMode } from "@/lib/availability";
import { getDepositPolicy } from "@/lib/deposit";
import { getLoyalty } from "@/lib/loyalty";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { WEEKDAYS } from "@/lib/format";
import { enabled } from "@/lib/messaging";
import { DEPOSIT_REFUND_HOURS, stripeEnabled } from "@/lib/payments";
import { derivedSecret } from "@/lib/secrets";
import { siteUrl } from "@/lib/site";
import {
  addAddonAction,
  saveLoyaltyAction,
  addPackAction,
  addServiceAction,
  addStaffAction,
  addTrendAction,
  deleteAddonAction,
  deletePackAction,
  deleteTrendAction,
  saveAddonAction,
  saveDepositPolicyAction,
  savePackAction,
  saveTrendAction,
  clearStaffHoursAction,
  saveHoursAction,
  saveModeAction,
  saveServiceAction,
  saveStaffAction,
  saveStaffHoursAction,
  testChannelAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ajustes", robots: { index: false, follow: false } };

type Svc = { aftercare: string | null; cancel_notice_hours: number | null; rebook_weeks: number | null; consent_kind: string | null; deposit_always: boolean; id: number; slug: string; name: string; category: string; duration_min: number; price_cents: number; slot_step_min: number | null; buffer_min: number; deposit_cents: number; active: boolean; sort: number };
type Hours = { weekday: number; closed: boolean; open: string | null; close: string | null; bs: string | null; be: string | null };
type StaffHours = Hours & { staff_id: number };
type Staff = { id: number; name: string; active: boolean };
type PackRow = { occasion: string | null; people: number; starts_on: string | null; ends_on: string | null; featured: boolean; id: number; name: string; emoji: string; description: string | null; service_slugs: string[]; discount_percent: number; active: boolean; sort: number };
type AddonRow = { id: number; name: string; description: string | null; duration_min: number; price_cents: number; category: string | null; active: boolean; sort: number };
type TrendRow = { id: number; emoji: string; title: string; body: string; topic: string; service_slug: string | null; active: boolean; sort: number };
const TOPIC_LABEL: Record<string, string> = { nails: "Uñas", lashes: "Pestañas", brows: "Cejas", wax: "Depilación", general: "General" };

const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];

function HoursRow({ d, h, hidden, action, extra }: { d: number; h?: Hours; hidden: Record<string, string | number>; action: (fd: FormData) => Promise<void>; extra?: string }) {
  return (
    <form action={action} className="svc svc--hours">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="weekday" value={d} />
      <strong className="svc__day">{WEEKDAYS[d]}</strong>
      <label className="check"><input type="checkbox" name="closed" defaultChecked={!h || h.closed} /><span>{extra ?? "Cerrado"}</span></label>
      <label className="field"><span>Abre</span><input type="time" name="open" defaultValue={h?.open ?? "10:00"} /></label>
      <label className="field"><span>Cierra</span><input type="time" name="close" defaultValue={h?.close ?? "20:00"} /></label>
      <label className="field"><span>Pausa desde</span><input type="time" name="bs" defaultValue={h?.bs ?? ""} /></label>
      <label className="field"><span>Pausa hasta</span><input type="time" name="be" defaultValue={h?.be ?? ""} /></label>
      <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
    </form>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel">
          <p>Necesitas entrar en la agenda primero.</p>
          <Link className="btn btn--primary" href="/admin">Ir a la agenda</Link>
        </section>
      </main>
    );
  }

  const [services, hoursRows, mode, staff, staffHours, cron, trends, packs, addons, policy, loyalty] = await Promise.all([
    query<Svc>(`SELECT id, slug, name, category, duration_min, price_cents, slot_step_min, buffer_min, deposit_cents, deposit_always, rebook_weeks, consent_kind, cancel_notice_hours, aftercare, active, sort FROM services ORDER BY active DESC, sort, id`),
    query<Hours>(
      `SELECT weekday, closed, to_char(open_time, 'HH24:MI') AS open, to_char(close_time, 'HH24:MI') AS close,
              to_char(break_start, 'HH24:MI') AS bs, to_char(break_end, 'HH24:MI') AS be FROM business_hours`,
    ),
    getSlotMode(),
    query<Staff>(`SELECT id, name, active FROM staff ORDER BY active DESC, sort, id`),
    query<StaffHours>(
      `SELECT staff_id, weekday, closed, to_char(open_time, 'HH24:MI') AS open, to_char(close_time, 'HH24:MI') AS close,
              to_char(break_start, 'HH24:MI') AS bs, to_char(break_end, 'HH24:MI') AS be FROM staff_hours`,
    ),
    query<{ mins: number | null }>(`SELECT (EXTRACT(EPOCH FROM (now() - value::timestamptz)) / 60)::int AS mins FROM settings WHERE key = 'last_cron_run'`),
    query<TrendRow>(`SELECT id, emoji, title, body, topic, service_slug, active, sort FROM trends ORDER BY active DESC, sort, id`).catch(() => [] as TrendRow[]),
    query<PackRow>(`SELECT id, name, emoji, description, service_slugs, discount_percent, active, sort, occasion, people, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, featured FROM packages ORDER BY active DESC, featured DESC, sort, id`).catch(() => [] as PackRow[]),
    query<AddonRow>(`SELECT id, name, description, duration_min, price_cents, category, active, sort FROM addons ORDER BY active DESC, sort, id`).catch(() => [] as AddonRow[]),
    getDepositPolicy().catch(() => ({ mode: "service" as const, afterNoShows: 1, defaultCents: 1000 })),
    getLoyalty().catch(() => ({ enabled: false, every: 10, reward: "una manicura clásica gratis" })),
  ]);
  const byDay = new Map(hoursRows.map((h) => [h.weekday, h]));
  const eur = (c: number) => (c / 100).toString().replace(".", ",");
  const cronMins = cron[0]?.mins ?? null;
  const depositWithoutStripe = !stripeEnabled() && services.some((s) => s.active && s.deposit_cents > 0);

  const checks: { label: string; ok: boolean; hint: string; test?: string }[] = [
    { label: "Aviso instantáneo a la dueña (Telegram)", ok: enabled.telegram(), hint: "TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID", test: "telegram" },
    { label: "Email (Resend)", ok: enabled.email() && !!process.env.OWNER_EMAIL, hint: "RESEND_API_KEY, MAIL_FROM y OWNER_EMAIL", test: "email" },
    { label: "SMS a las clientas (Twilio)", ok: enabled.sms(), hint: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM", test: "sms" },
    { label: "WhatsApp Business (Meta)", ok: enabled.whatsapp(), hint: "WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID", test: "whatsapp" },
    { label: "Botones Confirmar / Cancelar dentro de WhatsApp", ok: !!process.env.WHATSAPP_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN, hint: "WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN (+ webhook en Meta)" },
    { label: "Recordatorios automáticos", ok: !!process.env.CRON_SECRET, hint: "CRON_SECRET en Vercel y en los secretos de GitHub" },
    { label: "Señal con tarjeta (Stripe)", ok: stripeEnabled(), hint: "STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET" },
    { label: "Dirección pública de la web", ok: !!process.env.NEXT_PUBLIC_SITE_URL || !!process.env.VERCEL_PROJECT_PRODUCTION_URL, hint: "NEXT_PUBLIC_SITE_URL" },
  ];
  const calendarUrl = `${siteUrl()}/api/calendar/${derivedSecret("calendar-feed")}.ics`;

  return (
    <main className="container admin">
      <AdminNav active="ajustes" />
      {sp.ok && <p className="notice notice--info" role="status">{sp.ok}</p>}
      {sp.err && <p className="notice notice--error" role="alert">{sp.err}</p>}
      <p className="muted">Los cambios afectan a los huecos que se ofrecen a partir de ahora. Las citas ya reservadas conservan su hora, su duración y su precio.</p>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Estado de la configuración</h2>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? "is-ok" : "is-missing"}>
              <span aria-hidden="true">{c.ok ? "✓" : "✗"}</span>
              <span><b>{c.label}</b>{!c.ok && <small>Falta: {c.hint}</small>}</span>
            </li>
          ))}
          <li className={cronMins !== null && cronMins <= 30 ? "is-ok" : "is-missing"}>
            <span aria-hidden="true">{cronMins !== null && cronMins <= 30 ? "✓" : "✗"}</span>
            <span>
              <b>Último ciclo de recordatorios</b>
              <small>{cronMins === null ? "Todavía no se ha ejecutado nunca: revisa el workflow de GitHub." : cronMins <= 30 ? `Hace ${cronMins} min` : `Hace ${cronMins} min: debería ejecutarse cada 10. Revisa GitHub Actions.`}</small>
            </span>
          </li>
        </ul>
        <h3 className="svc__new">Enviar un mensaje de prueba</h3>
        <form action={testChannelAction} className="form form--grid">
          <label className="field field--wide"><span>Teléfono para SMS y WhatsApp (con prefijo)</span>
            <input name="phone" type="tel" defaultValue={process.env.NOTIFY_TEST_PHONE ?? ""} placeholder="+34600123456" />
          </label>
          {checks.filter((c) => c.test).map((c) => (
            <button key={c.test} className="btn btn--ghost btn--sm" type="submit" name="channel" value={c.test}>Probar {c.test === "telegram" ? "Telegram" : c.test === "email" ? "email" : c.test === "sms" ? "SMS" : "WhatsApp"}</button>
          ))}
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Calendario en tu móvil</h2>
        <p className="muted small">Suscríbete una vez y las citas aparecen solas en tu calendario (Apple, Google u Outlook). Es una dirección secreta: no la compartas.</p>
        <div className="copybox">
          <a href={calendarUrl.replace(/^https?:/, "webcal:")}>Suscribirme (iPhone y Mac)</a>
          <code>{calendarUrl}</code>
        </div>
        <p className="muted small">En Google Calendar: Otros calendarios → Desde URL → pega la dirección de arriba (Google tarda unas horas en refrescar).</p>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Políticas actuales</h2>
        <ul className="muted">
          <li>Recordatorio con Confirmar / Cancelar: {process.env.REMINDER_HOURS_BEFORE ?? 4} h antes.</li>
          <li>Cancelar online: hasta {CONFIG.cancelNoticeHours} h antes (desde el recordatorio, siempre).</li>
          <li>Cambiar la hora online: hasta {process.env.RESCHEDULE_NOTICE_HOURS ?? 12} h antes.</li>
          <li>Señal: se devuelve si cancela con {DEPOSIT_REFUND_HOURS} h o más; si no, se retiene. Si el centro cancela, siempre se devuelve.</li>
          <li>Aviso de plantones: a partir de {process.env.NO_SHOW_ALERT ?? 2}.</li>
        </ul>
        <p className="muted small">Se cambian con variables de entorno (README).</p>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Cómo se ofrecen los huecos</h2>
        <form action={saveModeAction} className="modes">
          {(Object.keys(SLOT_MODES) as SlotMode[]).map((m) => (
            <label key={m} className={`mode ${mode === m ? "is-on" : ""}`}>
              <input type="radio" name="mode" value={m} defaultChecked={mode === m} />
              <span><b>{SLOT_MODES[m].label}</b><small>{SLOT_MODES[m].help}</small></span>
            </label>
          ))}
          <button className="btn btn--primary" type="submit">Guardar modo</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Servicios</h2>
        <p className="muted small">
          El hueco de cada servicio es su duración. «Limpieza» son los minutos que quedan bloqueados después (la clienta no los ve). «Señal» se cobra con tarjeta al reservar y se descuenta del total. Para quitar un servicio, desmarca «Activo»: no se borra.
        </p>
        {depositWithoutStripe && <p className="notice notice--error" role="alert">Hay servicios con señal, pero Stripe no está configurado: de momento se reservan sin cobrar señal.</p>}
        <div className="svc-list">
          {services.map((s) => (
            <form key={s.id} action={saveServiceAction} className={`svc ${s.active ? "" : "svc--off"}`}>
              <input type="hidden" name="id" value={s.id} />
              <label className="field"><span>Servicio</span><input name="name" defaultValue={s.name} required maxLength={80} /></label>
              <label className="field"><span>Categoría</span><input name="category" defaultValue={s.category} required maxLength={60} /></label>
              <label className="field"><span>Duración (min)</span><input name="duration" type="number" min={5} max={480} step={5} defaultValue={s.duration_min} required /></label>
              <label className="field"><span>Limpieza (min)</span><input name="buffer" type="number" min={0} max={120} step={5} defaultValue={s.buffer_min} /></label>
              <label className="field"><span>Precio (€)</span><input name="price" inputMode="decimal" defaultValue={eur(s.price_cents)} required /></label>
              <label className="field"><span>Señal (€)</span><input name="deposit" inputMode="decimal" defaultValue={eur(s.deposit_cents)} /></label>
              <label className="field"><span>Hueco (min)</span><input name="step" type="number" min={5} max={480} step={5} defaultValue={s.slot_step_min ?? ""} placeholder={String(s.duration_min)} /></label>
              <label className="field"><span>Orden</span><input name="sort" type="number" min={0} defaultValue={s.sort} /></label>
              <label className="field"><span>Retoque (semanas)</span><input name="rebook" type="number" min={1} max={26} defaultValue={s.rebook_weeks ?? ""} placeholder="—" /></label>
              <label className="field"><span>Cancelar con (horas)</span><input name="notice" type="number" min={0} max={168} defaultValue={s.cancel_notice_hours ?? ""} placeholder={String(CONFIG.cancelNoticeHours)} /></label>
              <label className="field"><span>Casillas de seguridad</span><select name="consent" defaultValue={s.consent_kind ?? ""}><option value="">Ninguna</option><option value="laser">Láser</option><option value="microblading">Microblading</option></select></label>
              <label className="check"><input type="checkbox" name="deposit_always" defaultChecked={s.deposit_always} /><span>Señal siempre</span></label>
              <label className="field field--wide"><span>Cuidados posteriores <em>(se envían tras la visita)</em></span><textarea name="aftercare" rows={2} maxLength={500} defaultValue={s.aftercare ?? ""} placeholder="Evita el agua muy caliente las primeras 24 h…" /></label>
              <label className="check svc__active"><input type="checkbox" name="active" defaultChecked={s.active} /><span>Activo</span></label>
              <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
            </form>
          ))}
        </div>
        <h3 className="svc__new">Añadir servicio</h3>
        <form action={addServiceAction} className="svc">
          <label className="field"><span>Servicio</span><input name="name" required maxLength={80} /></label>
          <label className="field"><span>Categoría</span><input name="category" required maxLength={60} list="cats" /></label>
          <datalist id="cats">{Array.from(new Set(services.map((s) => s.category))).map((c) => <option key={c} value={c} />)}</datalist>
          <label className="field"><span>Duración (min)</span><input name="duration" type="number" min={5} max={480} step={5} defaultValue={30} required /></label>
          <label className="field"><span>Limpieza (min)</span><input name="buffer" type="number" min={0} max={120} step={5} defaultValue={0} /></label>
          <label className="field"><span>Precio (€)</span><input name="price" inputMode="decimal" defaultValue="0" required /></label>
          <label className="field"><span>Señal (€)</span><input name="deposit" inputMode="decimal" defaultValue="0" /></label>
          <label className="field"><span>Hueco (min)</span><input name="step" type="number" min={5} max={480} step={5} placeholder="= duración" /></label>
          <label className="field"><span>Orden</span><input name="sort" type="number" min={0} defaultValue={500} /></label>
          <label className="field"><span>Retoque (semanas)</span><input name="rebook" type="number" min={1} max={26} placeholder="—" /></label>
          <label className="field"><span>Cancelar con (horas)</span><input name="notice" type="number" min={0} max={168} placeholder={String(CONFIG.cancelNoticeHours)} /></label>
          <label className="field"><span>Casillas de seguridad</span><select name="consent" defaultValue=""><option value="">Ninguna</option><option value="laser">Láser</option><option value="microblading">Microblading</option></select></label>
          <label className="check"><input type="checkbox" name="deposit_always" /><span>Señal siempre</span></label>
          <button className="btn btn--primary btn--sm" type="submit">Añadir</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Señal inteligente</h2>
        <p className="muted small">
          Solo funciona si tienes los cobros con tarjeta (Stripe) activados. «Según el servicio» pide la señal que lleve cada servicio, como siempre.
          «Solo a quien ya ha faltado» la pide únicamente a las clientas con plantones (y a los servicios marcados «Señal siempre»): las clientas nuevas y cumplidoras reservan sin pagar nada.
          Nunca se le dice a nadie su historial: solo se le avisa de que, si ha faltado antes, se le pedirá una señal.
        </p>
        <form action={saveDepositPolicyAction} className="svc">
          <label className="field field--wide"><span>A quién se le pide</span>
            <select name="policy" defaultValue={policy.mode}>
              <option value="service">Según el servicio (como ahora)</option>
              <option value="repeat">Solo a quien ya ha faltado</option>
            </select>
          </label>
          <label className="field field--narrow"><span>Plantones</span><input type="number" name="after" min={1} max={10} defaultValue={policy.afterNoShows} /></label>
          <label className="field"><span>Importe si el servicio no lleva señal (€)</span><input name="amount" inputMode="decimal" defaultValue={eur(policy.defaultCents)} /></label>
          <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Fidelidad (sellos)</h2>
        <p className="muted small">
          Cada visita a la que viene suma un sello a la tarjeta de la clienta (lo ve en el enlace de su cita). Al completarla hay un premio que canjeas a mano desde su ficha en «Clientas».
        </p>
        <form action={saveLoyaltyAction} className="svc">
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={loyalty.enabled} /><span>Activar el programa de sellos</span></label>
          <label className="field field--narrow"><span>Visitas por premio</span><input type="number" name="every" min={2} max={50} defaultValue={loyalty.every} /></label>
          <label className="field field--wide"><span>Premio</span><input name="reward" maxLength={80} defaultValue={loyalty.reward} /></label>
          <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Packs</h2>
        <p className="muted small">
          Combinaciones de servicios ya pensadas que la clienta ve al principio de la reserva y que Diva recomienda. El descuento (0 = ninguno) se aplica solo si elige exactamente esos servicios.
          <b> Los de ejemplo vienen sin descuento: ponlo tú si quieres.</b>
        </p>
        <div className="svc-list">
          {packs.map((p) => (
            <form key={p.id} action={savePackAction} className={`svc svc--pack ${p.active ? "" : "svc--off"}`}>
              <input type="hidden" name="id" value={p.id} />
              <label className="field field--emoji"><span>Emoji</span><input name="emoji" defaultValue={p.emoji} maxLength={8} required /></label>
              <label className="field"><span>Nombre</span><input name="name" defaultValue={p.name} required maxLength={60} /></label>
              <label className="field field--wide"><span>Descripción corta</span><input name="description" defaultValue={p.description ?? ""} maxLength={160} /></label>
              <label className="field field--narrow"><span>Descuento %</span><input type="number" name="discount" min={0} max={90} defaultValue={p.discount_percent} /></label>
              <label className="field field--narrow"><span>Orden</span><input type="number" name="sort" min={0} max={9999} defaultValue={p.sort} /></label>
              <label className="field"><span>Ocasión <em>(etiqueta)</em></span><input name="occasion" defaultValue={p.occasion ?? ""} maxLength={40} placeholder="Boda, Camino…" /></label>
              <label className="field field--narrow"><span>Personas</span><select name="people" defaultValue={String(p.people)}><option value="1">1</option><option value="2">2 (para dos)</option></select></label>
              <label className="field"><span>Desde <em>(temporada)</em></span><input type="date" name="starts_on" defaultValue={p.starts_on ?? ""} /></label>
              <label className="field"><span>Hasta</span><input type="date" name="ends_on" defaultValue={p.ends_on ?? ""} /></label>
              <label className="check"><input type="checkbox" name="featured" defaultChecked={p.featured} /><span>⭐ Pack destacado (el del mes)</span></label>
              <fieldset className="pack-edit"><legend>Servicios del pack (en uno «para dos» se hacen dos veces)</legend>
                {services.filter((x) => x.active || p.service_slugs.includes(x.slug)).map((x) => (
                  <label key={x.id} className="check"><input type="checkbox" name="services" value={x.slug} defaultChecked={p.service_slugs.includes(x.slug)} /><span>{x.name}</span></label>
                ))}
              </fieldset>
              <label className="check svc__active"><input type="checkbox" name="active" defaultChecked={p.active} /><span>Activo</span></label>
              <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
              <button className="btn btn--ghost btn--sm" type="submit" formAction={deletePackAction}>Borrar</button>
            </form>
          ))}
        </div>
        <h3 className="svc__new">Añadir pack</h3>
        <form action={addPackAction} className="svc svc--pack">
          <label className="field field--emoji"><span>Emoji</span><input name="emoji" defaultValue="🎁" maxLength={8} required /></label>
          <label className="field"><span>Nombre</span><input name="name" required maxLength={60} placeholder="Día de novia" /></label>
          <label className="field field--wide"><span>Descripción corta</span><input name="description" maxLength={160} /></label>
          <label className="field field--narrow"><span>Descuento %</span><input type="number" name="discount" min={0} max={90} defaultValue={0} /></label>
          <label className="field field--narrow"><span>Orden</span><input type="number" name="sort" min={0} max={9999} defaultValue={100} /></label>
          <label className="field"><span>Ocasión <em>(etiqueta)</em></span><input name="occasion" maxLength={40} placeholder="Boda, Camino…" /></label>
          <label className="field field--narrow"><span>Personas</span><select name="people" defaultValue="1"><option value="1">1</option><option value="2">2 (para dos)</option></select></label>
          <label className="field"><span>Desde <em>(temporada)</em></span><input type="date" name="starts_on" /></label>
          <label className="field"><span>Hasta</span><input type="date" name="ends_on" /></label>
          <label className="check"><input type="checkbox" name="featured" /><span>⭐ Pack destacado (el del mes)</span></label>
          <fieldset className="pack-edit"><legend>Servicios del pack (mínimo 2, o 1 si es «para dos»)</legend>
            {services.filter((x) => x.active).map((x) => (
              <label key={x.id} className="check"><input type="checkbox" name="services" value={x.slug} /><span>{x.name}</span></label>
            ))}
          </fieldset>
          <button className="btn btn--primary btn--sm" type="submit">Añadir</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Extras que suman tiempo</h2>
        <p className="muted small">Retirada de esmalte, nail art… La clienta los marca al elegir hora y suman su duración y su precio a la cita. Si eliges una categoría, solo se ofrecen con servicios de esa categoría.</p>
        <div className="svc-list">
          {addons.map((a) => (
            <form key={a.id} action={saveAddonAction} className={`svc ${a.active ? "" : "svc--off"}`}>
              <input type="hidden" name="id" value={a.id} />
              <label className="field"><span>Extra</span><input name="name" defaultValue={a.name} required maxLength={60} /></label>
              <label className="field field--wide"><span>Descripción</span><input name="description" defaultValue={a.description ?? ""} maxLength={160} /></label>
              <label className="field"><span>Duración (min)</span><input name="duration" type="number" min={5} max={240} step={5} defaultValue={a.duration_min} required /></label>
              <label className="field"><span>Precio (€)</span><input name="price" inputMode="decimal" defaultValue={eur(a.price_cents)} required /></label>
              <label className="field"><span>Se ofrece con</span>
                <select name="category" defaultValue={a.category ?? ""}>
                  <option value="">Cualquier servicio</option>
                  {Array.from(new Set(services.map((s) => s.category))).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field field--narrow"><span>Orden</span><input type="number" name="sort" min={0} max={9999} defaultValue={a.sort} /></label>
              <label className="check svc__active"><input type="checkbox" name="active" defaultChecked={a.active} /><span>Activo</span></label>
              <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
              <button className="btn btn--ghost btn--sm" type="submit" formAction={deleteAddonAction}>Borrar</button>
            </form>
          ))}
        </div>
        <h3 className="svc__new">Añadir extra</h3>
        <form action={addAddonAction} className="svc">
          <label className="field"><span>Extra</span><input name="name" required maxLength={60} /></label>
          <label className="field field--wide"><span>Descripción</span><input name="description" maxLength={160} /></label>
          <label className="field"><span>Duración (min)</span><input name="duration" type="number" min={5} max={240} step={5} defaultValue={15} required /></label>
          <label className="field"><span>Precio (€)</span><input name="price" inputMode="decimal" defaultValue="5" required /></label>
          <label className="field"><span>Se ofrece con</span>
            <select name="category" defaultValue="">
              <option value="">Cualquier servicio</option>
              {Array.from(new Set(services.map((s) => s.category))).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field field--narrow"><span>Orden</span><input type="number" name="sort" min={0} max={9999} defaultValue={100} /></label>
          <button className="btn btn--primary btn--sm" type="submit">Añadir</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Horario del salón</h2>
        <p className="muted small">Pausa opcional (p. ej. 14:00 a 16:00): los huecos se calculan por separado antes y después de la pausa.</p>
        <div className="svc-list">
          {DAYS_ORDER.map((d) => <HoursRow key={d} d={d} h={byDay.get(d)} hidden={{}} action={saveHoursAction} />)}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Profesionales</h2>
        <p className="muted small">Con más de una profesional, la clienta puede elegir con quién (o «la primera libre»). Cada una puede tener su propio horario; para sus vacaciones usa «Bloquear horario» en Hoy.</p>
        <div className="svc-list">
          {staff.map((p) => {
            const own = staffHours.filter((h) => h.staff_id === p.id);
            const ownMap = new Map(own.map((h) => [h.weekday, h]));
            return (
              <div key={p.id} className={`staffbox ${p.active ? "" : "svc--off"}`}>
                <form action={saveStaffAction} className="svc">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="field"><span>Nombre</span><input name="name" defaultValue={p.name} required maxLength={60} /></label>
                  <label className="check svc__active"><input type="checkbox" name="active" defaultChecked={p.active} /><span>Activa</span></label>
                  <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
                </form>
                <details>
                  <summary>{own.length ? `Horario propio de ${p.name} (${own.length} días definidos)` : `Usa el horario del salón. Pulsa para darle uno propio`}</summary>
                  <div className="svc-list">
                    {DAYS_ORDER.map((d) => (
                      <HoursRow key={d} d={d} h={ownMap.get(d) ?? byDay.get(d)} hidden={{ staffId: p.id }} action={saveStaffHoursAction} extra="No trabaja" />
                    ))}
                  </div>
                  {own.length > 0 && (
                    <form action={clearStaffHoursAction}>
                      <input type="hidden" name="staffId" value={p.id} />
                      <button className="btn btn--ghost btn--sm" type="submit">Volver al horario del salón</button>
                    </form>
                  )}
                </details>
              </div>
            );
          })}
        </div>
        <h3 className="svc__new">Añadir profesional</h3>
        <form action={addStaffAction} className="svc">
          <label className="field"><span>Nombre</span><input name="name" required maxLength={60} /></label>
          <button className="btn btn--primary btn--sm" type="submit">Añadir</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Tendencias del avatar</h2>
        <p className="muted small">
          La chica de la reserva cuenta estas tendencias (sola, cada cierto rato, o cuando la clienta le pregunta «¿qué se lleva?»). Si eliges un servicio, le ofrece añadirlo a su cita con un toque.
          Están puestas como orientación para el otoño 2026: <b>cámbialas cuando cambie la temporada</b> y deja solo lo que de verdad hacéis.
        </p>
        <div className="svc-list">
          {trends.map((t) => (
            <form key={t.id} action={saveTrendAction} className={`svc svc--trend ${t.active ? "" : "svc--off"}`}>
              <input type="hidden" name="id" value={t.id} />
              <label className="field field--emoji"><span>Emoji</span><input name="emoji" defaultValue={t.emoji} required maxLength={8} /></label>
              <label className="field"><span>Título</span><input name="title" defaultValue={t.title} required maxLength={60} /></label>
              <label className="field field--wide"><span>Lo que cuenta</span><textarea name="body" defaultValue={t.body} required maxLength={280} rows={2} /></label>
              <label className="field"><span>Tema</span>
                <select name="topic" defaultValue={t.topic}>{Object.entries(TOPIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="field"><span>Servicio que ofrece</span>
                <select name="service_slug" defaultValue={t.service_slug ?? ""}>
                  <option value="">Ninguno</option>
                  {services.filter((s) => s.active).map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
                </select>
              </label>
              <label className="field field--narrow"><span>Orden</span><input type="number" name="sort" defaultValue={t.sort} min={0} max={9999} /></label>
              <label className="check svc__active"><input type="checkbox" name="active" defaultChecked={t.active} /><span>Activa</span></label>
              <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
              <button className="btn btn--ghost btn--sm" type="submit" formAction={deleteTrendAction}>Borrar</button>
            </form>
          ))}
        </div>
        <h3 className="svc__new">Añadir tendencia</h3>
        <form action={addTrendAction} className="svc svc--trend">
          <label className="field field--emoji"><span>Emoji</span><input name="emoji" defaultValue="✨" required maxLength={8} /></label>
          <label className="field"><span>Título</span><input name="title" required maxLength={60} placeholder="Verde oliva" /></label>
          <label className="field field--wide"><span>Lo que cuenta</span><textarea name="body" required maxLength={280} rows={2} placeholder="Una o dos frases, en tono cercano." /></label>
          <label className="field"><span>Tema</span>
            <select name="topic" defaultValue="nails">{Object.entries(TOPIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field"><span>Servicio que ofrece</span>
            <select name="service_slug" defaultValue="">
              <option value="">Ninguno</option>
              {services.filter((s) => s.active).map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
            </select>
          </label>
          <label className="field field--narrow"><span>Orden</span><input type="number" name="sort" defaultValue={100} min={0} max={9999} /></label>
          <button className="btn btn--primary btn--sm" type="submit">Añadir</button>
        </form>
      </section>

      <form action={logout} className="admin__logout-bottom">
        <button className="btn btn--ghost" type="submit">Cerrar sesión</button>
      </form>
    </main>
  );
}
