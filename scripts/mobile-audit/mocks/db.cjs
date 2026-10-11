const H = 3600000;
const NOW = Date.now();
const d = (h) => new Date(NOW + h * H);
const dayStr = (date) => date.toISOString().slice(0, 10);
const today = new Date();
const dow = today.getUTCDay();
const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((dow + 6) % 7)));
const wk = (i) => dayStr(new Date(monday.getTime() + i * 86400000));

const SERVICES = [
  ["manicura-semipermanente", "Manicura semipermanente", "Manicura y pedicura", "Limado, cutículas y esmaltado semipermanente.", 45, 1800, 0],
  ["manicura-clasica", "Manicura clásica", "Manicura y pedicura", "Limado, cutículas y esmalte tradicional.", 30, 1200, 0],
  ["pedicura", "Pedicura", "Manicura y pedicura", "Tratamiento completo de pies.", 50, 2200, 0],
  ["pedicura-semipermanente", "Pedicura semipermanente", "Manicura y pedicura", "Pedicura con esmaltado semipermanente.", 60, 2800, 0],
  ["lifting-pestanas", "Lifting de pestañas", "Mirada", "Curvatura y definición natural de tus pestañas.", 60, 3500, 0],
  ["tinte-cejas", "Tinte de cejas", "Mirada", null, 20, 800, 0],
  ["microblading", "Microblading de cejas", "Mirada", "Incluye diseño personalizado.", 120, 25000, 5000],
  ["hilo-cejas", "Cejas con hilo", "Depilación", null, 15, 600, 0],
  ["hilo-cara", "Cara completa con hilo", "Depilación", null, 30, 1500, 0],
  ["laser-pequena", "Láser · zona pequeña", "Depilación", "Labio, axilas, ingles...", 15, 2500, 0],
  ["laser-mediana", "Láser · zona mediana", "Depilación", "Medias piernas, brazos...", 30, 4500, 0],
  ["laser-piernas", "Láser · piernas completas", "Depilación", null, 60, 8000, 3000],
].map((r, i) => ({ id: i + 1, slug: r[0], name: r[1], category: r[2], description: r[3], durationMin: r[4], priceCents: r[5], depositCents: r[6] }));
for (const s of SERVICES) {
  s.depositAlways = s.depositCents > 0;
  s.rebookWeeks = { "manicura-semipermanente": 3, "pedicura-semipermanente": 4, "lifting-pestanas": 6 }[s.slug] ?? null;
  s.consentKind = s.slug.startsWith("laser-") ? "laser" : s.slug === "microblading" ? "microblading" : null;
}
const SERVICES_FULL = SERVICES.map((s, i) => ({ rebook_weeks: s.rebookWeeks, consent_kind: s.consentKind, deposit_always: s.depositAlways, id: s.id, slug: s.slug, name: s.name, category: s.category, duration_min: s.durationMin, price_cents: s.priceCents, slot_step_min: null, buffer_min: i === 0 ? 10 : 0, deposit_cents: s.depositCents, active: true, sort: (i + 1) * 10 }));

const HOURS_RAW = [0, 1, 2, 3, 4, 5, 6].map((w) => w === 0 ? { weekday: 0, closed: true, o: null, c: null, bs: null, be: null } : w === 6 ? { weekday: 6, closed: false, o: "10:00", c: "14:00", bs: null, be: null } : { weekday: w, closed: false, o: "10:00", c: "20:00", bs: "14:00", be: "16:00" });
const HOURS_TEXT = HOURS_RAW.map((h) => ({ weekday: h.weekday, closed: h.closed, open_time: h.o && h.o + ":00", close_time: h.c && h.c + ":00", break_start: h.bs && h.bs + ":00", break_end: h.be && h.be + ":00" }));
const HOURS_HM = HOURS_RAW.map((h) => ({ weekday: h.weekday, closed: h.closed, open: h.o, close: h.c, bs: h.bs, be: h.be }));

const sumRow = (o = {}) => ({
  id: "11111111-1111-1111-1111-111111111111", code: "AB12CD34", hold_token: "t".repeat(48), status: "CONFIRMED",
  starts_at: d(30), ends_at: d(30.75), customer_name: "María García López", customer_phone: "600123456", customer_email: null, notes: "Color: Rosa chicle",
  service_name: "Manicura semipermanente", service_ids: [1], price_cents: 1800, deposit_cents: 0, deposit_status: "NONE", attendance: null,
  staff_id: 1, staff_name: "Pro Diva", customer_id: 7, can_cancel: true, customer_response: null, cancel_reason: null,
  notice_hours: 24, refund_hours: 24, group_id: null, cancel_why: null, reschedule_free: false, centre_note: null, ...o,
});

const AGENDA = [
  { id: "a1", code: "AAAA1111", status: "CONFIRMED", source: "web", t_start: "10:00", t_end: "10:45", start_iso: d(-2), customer_name: "María García López", customer_phone: "600123456", notes: "Color: Rosa chicle", customer_response: "CONFIRMED", reminder_sent_at: d(-4), attendance: "SHOWED", deposit_status: "NONE", deposit_cents: 0, customer_id: 7, no_shows: 0, cancel_reason: null, cancelled_at: null, started: true, service_name: "Manicura semipermanente", price_cents: 1800, staff_name: "Pro Diva" },
  { id: "a2", code: "AAAA2222", status: "CANCELLED", source: "web", t_start: "11:00", t_end: "11:30", start_iso: d(1), customer_name: "Lucía Fernández", customer_phone: "611222333", notes: null, customer_response: "CANCELLED", reminder_sent_at: null, attendance: null, deposit_status: "NONE", deposit_cents: 0, customer_id: 8, no_shows: 0, cancel_reason: "customer_reminder", cancelled_at: "10/10 08:12", started: false, service_name: "Manicura clásica", price_cents: 1200, staff_name: "Pro Diva" },
  { id: "a3", code: "AAAA3333", status: "CONFIRMED", source: "admin", t_start: "12:00", t_end: "14:00", start_iso: d(2), customer_name: "Carmen Rodríguez Pérez de la Fuente", customer_phone: "622333444", notes: "Alergia al látex y a algunos pigmentos. Prefiere diseño fino.", customer_response: null, reminder_sent_at: d(-1), attendance: null, deposit_status: "PAID", deposit_cents: 5000, customer_id: 9, no_shows: 3, cancel_reason: null, cancelled_at: null, started: true, service_name: "Microblading de cejas + Tinte de cejas", price_cents: 26000, staff_name: "Pro Diva" },
  { id: "a4", code: "AAAA4444", status: "CONFIRMED", source: "web", t_start: "16:00", t_end: "16:50", start_iso: d(5), customer_name: "Ana", customer_phone: "633444555", notes: null, customer_response: null, reminder_sent_at: null, attendance: "NO_SHOW", deposit_status: "FORFEITED", deposit_cents: 3000, customer_id: 10, no_shows: 1, cancel_reason: null, cancelled_at: null, started: true, service_name: "Pedicura", price_cents: 2200, staff_name: "Pro Diva" },
  { id: "a5", code: "AAAA5555", status: "HOLD", source: "web", t_start: "17:30", t_end: "18:00", start_iso: d(7), customer_name: null, customer_phone: null, notes: null, customer_response: null, reminder_sent_at: null, attendance: null, deposit_status: "PENDING", deposit_cents: 0, customer_id: null, no_shows: null, cancel_reason: null, cancelled_at: null, started: false, service_name: "Cejas con hilo", price_cents: 600, staff_name: "Pro Diva" },
];

const WEEK_BK = [
  { id: "w1", day: wk(0), sm: 600, em: 645, name: "María García", status: "CONFIRMED", response: "CONFIRMED", attendance: null, deposit: "NONE", staff_id: 1, service: "Manicura semipermanente" },
  { id: "w2", day: wk(0), sm: 660, em: 690, name: "Lucía Fdez", status: "CANCELLED", response: null, attendance: null, deposit: "NONE", staff_id: 1, service: "Manicura clásica" },
  { id: "w3", day: wk(1), sm: 720, em: 840, name: "Carmen Rodríguez", status: "CONFIRMED", response: null, attendance: null, deposit: "PAID", staff_id: 1, service: "Microblading" },
  { id: "w4", day: wk(2), sm: 960, em: 1010, name: "Ana", status: "CONFIRMED", response: null, attendance: "NO_SHOW", deposit: "NONE", staff_id: 1, service: "Pedicura" },
  { id: "w5", day: wk(3), sm: 1020, em: 1050, name: "Marta", status: "CONFIRMED", response: "CONFIRMED", attendance: "SHOWED", deposit: "NONE", staff_id: 1, service: "Cejas con hilo" },
  { id: "w6", day: wk(4), sm: 600, em: 660, name: "Elena", status: "HOLD", response: null, attendance: null, deposit: "PENDING", staff_id: 1, service: "Lifting de pestañas" },
  { id: "w7", day: wk(5), sm: 630, em: 690, name: "Laura Gómez Martínez", status: "CONFIRMED", response: null, attendance: null, deposit: "NONE", staff_id: 1, service: "Pedicura semipermanente + Manicura" },
];

function route(sql) {
  const s = sql.replace(/\s+/g, " ");
  const V = globalThis.__VARIANT__ || {};
  if (/AS "durationMin"/.test(s) && /FROM services/.test(s)) return SERVICES;
  if (/FROM business_hours ORDER BY weekday/.test(s) && /open_time::text/.test(s)) return HOURS_TEXT;
  if (/SELECT id, name FROM staff WHERE active ORDER BY sort, id/.test(s)) return V.staff2 ? [{ id: 1, name: "Pro Diva" }, { id: 2, name: "Marta" }] : [{ id: 1, name: "Pro Diva" }];
  // resumen de cita
  if (/ANY\(\$1::bigint\[\]\)/.test(s)) return V.others || [];
  if (/SELECT visit_count, loyalty_redeemed FROM customers/.test(s)) return [{ visit_count: 7, loyalty_redeemed: 0 }];
  if (/FROM reviews r JOIN bookings b/.test(s)) return [
    { id: 1, rating: 5, comment: "Me ha encantado, el color es precioso.", google_clicked: true, at: "09/10/2026", booking_id: "a1", name: "María García López", phone: "600123456", service: "Manicura semipermanente" },
    { id: 2, rating: 2, comment: "Tuve que esperar 20 minutos y no me avisaron.", google_clicked: false, at: "08/10/2026", booking_id: "a2", name: "Lucía Fernández", phone: "611222333", service: "Pedicura" },
    { id: 3, rating: 4, comment: null, google_clicked: false, at: "07/10/2026", booking_id: "a3", name: "Carmen Rodríguez", phone: "622333444", service: "Lifting de pestañas" }];
  if (/AS service_ids/.test(s)) return [V.booking || sumRow()];
  // agenda
  if (/AS t_start/.test(s) && /FROM bookings b/.test(s)) return V.noCancelled ? AGENDA.filter((a) => a.status !== "CANCELLED") : AGENDA;
  if (/SELECT id, name, duration_min FROM services WHERE active/.test(s)) return SERVICES_FULL.map((x) => ({ id: x.id, name: x.name, duration_min: x.duration_min }));
  if (/FROM time_off t LEFT JOIN staff st/.test(s)) return [{ id: 1, day: wk(3), t_start: "00:00", t_end: "00:00", staff_name: null, reason: "Vacaciones" }, { id: 2, day: wk(4), t_start: "16:00", t_end: "18:00", staff_name: null, reason: "Médico" }];
  if (/FROM waitlist w JOIN services s/.test(s)) return [{ id: "w-1", day: wk(2), part: "MORNING", name: "Rosa Martínez", phone: "644555666", status: "ACTIVE", service_name: "Manicura semipermanente" }, { id: "w-2", day: null, part: "ANY", name: "Paula", phone: "655666777", status: "NOTIFIED", service_name: "Microblading de cejas" }];
  if (/FROM callbacks WHERE status/.test(s)) return [{ id: 1, name: "Josefa Lage", phone: "666777888", created: "10/10 09:03" }];
  // semana
  if (/AS sm/.test(s)) return WEEK_BK;
  if (/AS e,/.test(s) || /AS s, to_char/.test(s)) return [{ s: wk(3) + "T14:00", e: wk(3) + "T16:00", staff_id: null, reason: "Médico" }];
  if (/AS open/.test(s) && /FROM business_hours/.test(s)) return HOURS_HM;
  if (/AS open/.test(s) && /FROM staff_hours/.test(s)) return [];
  // detalle de cita
  if (/FROM booking_services WHERE booking_id/.test(s)) return [{ name: "Manicura semipermanente", duration_min: 45, price_cents: 1800, deposit_cents: 0 }];
  if (/FROM notification_log WHERE booking_id/.test(s)) return [{ kind: "created", channel: "whatsapp", status: "SENT", delivery_status: "read", detail: null, at: "09/10 12:01" }, { kind: "reminder", channel: "whatsapp", status: "SENT", delivery_status: "sent", detail: null, at: "10/10 08:30" }, { kind: "reminder", channel: "sms", status: "FAILED", delivery_status: null, detail: "x", at: "10/10 09:00" }];
  if (/AS day, to_char\(starts_at/.test(s)) return [{ day: wk(2), time: "17:15" }];
  // clientas
  if (/FROM customers c WHERE/.test(s)) return [
    { id: 9, name: "Carmen Rodríguez Pérez de la Fuente", phone: "622333444", no_show_count: 3, visit_count: 4, total: 9, last: "08/10/2026" },
    { id: 7, name: "María García", phone: "600123456", no_show_count: 0, visit_count: 12, total: 13, last: "10/10/2026" },
    { id: 8, name: "Lucía Fernández", phone: "611222333", no_show_count: 1, visit_count: 2, total: 3, last: null }];
  if (/FROM customers WHERE id/.test(s)) return [{ id: 9, name: "Carmen Rodríguez Pérez de la Fuente", phone: "622333444", email: "carmen@example.com", notes: "Alergia al látex.", no_show_count: 3, visit_count: 4, since: "03/02/2026" }];
  if (/AS "when"/.test(s)) return [
    { id: "h1", iso: d(-48), when: "08/10/2026 10:00", status: "CONFIRMED", attendance: "SHOWED", deposit: "NONE", service: "Manicura semipermanente", price: 1800 },
    { id: "h2", iso: d(-90), when: "06/10/2026 12:00", status: "CANCELLED", attendance: null, deposit: "NONE", service: "Pedicura", price: 2200 },
    { id: "h3", iso: d(-200), when: "30/09/2026 16:00", status: "CONFIRMED", attendance: "NO_SHOW", deposit: "FORFEITED", service: "Microblading de cejas", price: 25000 }];
  // ajustes
  if (/buffer_min, deposit_cents, active, sort FROM services/.test(s)) return SERVICES_FULL;
  if (/FROM settings WHERE key = 'slot_mode'/.test(s)) return [{ value: "smart" }];
  if (/SELECT id, name, active FROM staff ORDER BY active DESC/.test(s)) return [{ id: 1, name: "Pro Diva", active: true }, { id: 2, name: "Marta", active: true }];
  if (/last_cron_run/.test(s)) return [{ mins: 7 }];
  if (/MIN\(duration_min\)/.test(s)) return [{ m: 15 }];
  if (/FROM addons/.test(s)) return [
    { id: 1, slug: "retirada-semipermanente", name: "Retirada de semipermanente", description: "Si llevas esmalte semipermanente.", durationMin: 15, priceCents: 500, duration_min: 15, price_cents: 500, active: true, sort: 10, category: "Manicura y pedicura" },
    { id: 2, slug: "nail-art-sencillo", name: "Nail art sencillo", description: null, durationMin: 15, priceCents: 500, duration_min: 15, price_cents: 500, active: true, sort: 20, category: "Manicura y pedicura" }];
  if (/FROM packages/.test(s)) return [
    { id: 1, slug: "manos-y-pies", name: "Manos y pies", emoji: "💅", description: "Manicura y pedicura a juego.", serviceSlugs: ["manicura-semipermanente", "pedicura-semipermanente"], discountPercent: 10, discount_percent: 10, service_slugs: ["manicura-semipermanente", "pedicura-semipermanente"], active: true, sort: 10, occasion: null, people: 1, starts_on: null, ends_on: "2026-12-31", featured: true },
    { id: 2, slug: "mirada-completa", name: "Mirada completa", emoji: "👁️", description: "Pestañas y cejas.", serviceSlugs: ["lifting-pestanas", "tinte-cejas", "hilo-cejas"], discountPercent: 0, discount_percent: 0, service_slugs: ["lifting-pestanas", "tinte-cejas", "hilo-cejas"], active: true, sort: 20 }];
  if (/FROM settings WHERE key IN/.test(s)) return [{ key: "deposit_policy", value: "service" }, { key: "deposit_after_no_shows", value: "1" }, { key: "deposit_default_cents", value: "1000" }, { key: "loyalty_enabled", value: "on" }, { key: "loyalty_every", value: "10" }, { key: "loyalty_reward", value: "una manicura clásica gratis" }];
  if (/FROM trends/.test(s)) return [
    { id: 1, emoji: "🍷", title: "Burdeos con brillo glow", body: "Los tonos borgoña y burdeos mandan este otoño.", topic: "nails", serviceSlug: "manicura-semipermanente", service_slug: "manicura-semipermanente", active: true, sort: 10 },
    { id: 2, emoji: "👁️", title: "Lifting de pestañas", body: "Mirada abierta sin extensiones.", topic: "lashes", serviceSlug: "lifting-pestanas", service_slug: "lifting-pestanas", active: true, sort: 70 }];
  console.warn("[mock db] SQL sin fixture:", s.slice(0, 110));
  return [];
}
const query = async (sql) => route(sql);
module.exports = { query, run: query, tx: async (fn) => fn(query, {}), pool: {}, sumRow, __esModule: true };
