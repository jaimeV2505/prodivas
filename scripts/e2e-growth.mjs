// Pruebas del blindaje, el embudo y el crecimiento. Necesitan la web en marcha con PHONE_VERIFY=new, DEMO_MODE=on y SIN
// DISABLE_RATE_LIMITS (la configuración normal de .env en local):   npm run test:growth
// ⚠️ Crea y borra citas «Growth Test» (teléfonos 6880000xx) en la base de datos de DATABASE_URL.
import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3101";
const CRON = process.env.CRON_SECRET || "local-cron-secret";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let pass = 0, fail = 0;
const check = (ok, msg, extra = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "✔" : "✘"} ${msg}${ok ? "" : " " + extra}`); };
const run = Math.floor(Math.random() * 200) + 1;
const ip = (n) => `10.${run}.${n}.${Math.floor(Math.random() * 250)}`;
const api = async (path, { method = "POST", body, ip: from = ip(1) } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": from }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const freeSlots = async (svc, from, to) => ((await api(`/api/availability?serviceId=${svc}&from=${day(from)}&to=${day(to)}`, { method: "GET" })).json.slots ?? []).filter((s) => s.available);
const hold = async (svc, slot, from) => (await api("/api/holds", { body: { serviceId: svc, startsAt: slot.startsAt }, ip: from })).json;
const cron = () => fetch(`${BASE}/api/cron/reminders`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } }).then((r) => r.json());
const phoneOf = (i) => `6880${String(run * 10 + i).padStart(5, "0")}`.slice(0, 9);
const PH = [1, 2, 3, 4, 5, 6, 7].map(phoneOf);

try {
  const svc = (await db.query(`SELECT id, slug FROM services WHERE active ORDER BY sort, id LIMIT 1`)).rows[0];
  const all = await freeSlots(svc.id, 6, 20);
  // huecos separados al menos 3 h para que las reservas de la prueba no se pisen entre sí
  const slots = all.filter((s, i) => { const prev = all.slice(0, i).filter((x) => x.__keep).pop(); if (!prev || new Date(s.startsAt) - new Date(prev.startsAt) >= 3 * 3600e3) { s.__keep = true; return true; } return false; });
  const myIp = ip(2);

  console.log("\n1. Verificación del teléfono");
  const h1 = await hold(svc.id, slots[0], myIp);
  const who = { holdId: h1.holdId, holdToken: h1.holdToken, name: "Growth Test", phone: PH[0], attr: { sid: `gt_${run}_1`, utm_source: "test", flow: "full", ref: undefined } };
  const c1 = await api("/api/bookings", { body: who, ip: myIp });
  check(c1.status === 401 && c1.json?.error?.code === "VERIFY", "un teléfono nuevo recibe un código antes de confirmar", JSON.stringify(c1.json?.error ?? c1.status));
  const code = c1.json?.error?.data?.devCode;
  check(/^\d{6}$/.test(code ?? ""), "en modo demostración el código llega en la respuesta");
  const bad = await api("/api/bookings", { body: { ...who, otp: code === "000000" ? "111111" : "000000" }, ip: myIp });
  check(bad.status === 401 && bad.json?.error?.data?.wrong === true, "un código falso se rechaza");
  const good = await api("/api/bookings", { body: { ...who, otp: code }, ip: myIp });
  check(good.status === 200 && good.json?.booking?.code, "con el código correcto se confirma", JSON.stringify(good.json?.error));
  const row = (await db.query(`SELECT utm_source, session_id FROM bookings WHERE code = $1`, [good.json?.booking?.code])).rows[0];
  check(row?.utm_source === "test" && row?.session_id === `gt_${run}_1`, "la reserva guarda de dónde vino (UTM y sesión)");
  await new Promise((r) => setTimeout(r, 1200));
  check((await db.query(`SELECT 1 FROM funnel_events WHERE session_id = $1 AND event = 'confirmed'`, [`gt_${run}_1`])).rowCount === 1, "el servidor apunta el paso «reservada» del embudo");
  const h2 = await hold(svc.id, slots[3], ip(3));
  const again = await api("/api/bookings", { body: { holdId: h2.holdId, holdToken: h2.holdToken, name: "Growth Test", phone: PH[0] }, ip: ip(3) });
  check(again.status === 200, "quien ya verificó su teléfono no vuelve a ver el código", JSON.stringify(again.json?.error));

  console.log("\n2. Frenos contra reservas falsas");
  const atk = ip(4);
  let limited = 0;
  for (let i = 1; i <= 6; i++) {
    const h = await hold(svc.id, slots[12 + i * 2], atk);
    const r = await api("/api/bookings", { body: { holdId: h.holdId, holdToken: h.holdToken, name: "Growth Test", phone: PH[i] }, ip: atk });
    if (r.status === 429) limited++;
  }
  check(limited >= 1, `desde una misma conexión no se aceptan más de 4 teléfonos distintos al día (bloqueados: ${limited})`);
  const wl = await api("/api/optout", { body: { token: "1.aaaaaaaaaaaaaaaaaaaaaaaa" } });
  check(wl.status === 404, "un enlace de baja con firma falsa se rechaza");

  console.log("\n3. Contacto a medias → recuperación → reservada");
  const lp = phoneOf(8);
  const hl = await hold(svc.id, slots[4], ip(5));
  const lead = await api("/api/leads", { body: { holdId: hl.holdId, holdToken: hl.holdToken, name: "Growth Lead", phone: lp, sid: `gt_${run}_lead` } });
  check(lead.status === 200 && (await db.query(`SELECT 1 FROM leads WHERE phone_key = $1 AND status = 'NEW'`, [lp.slice(-9)])).rowCount === 1, "el teléfono dejado a medias queda guardado");
  await db.query(`UPDATE leads SET created_at = now() - interval '40 minutes' WHERE phone_key = $1`, [lp.slice(-9)]);
  await api(`/api/holds/${hl.holdId}?token=${hl.holdToken}`, { method: "DELETE" });
  await db.query(`UPDATE settings SET value = 'on' WHERE key = 'abandon_recovery'`);
  const cr = await cron();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(new Date())) % 24;
  if (hour >= 10 && hour < 20) {
    check((await db.query(`SELECT 1 FROM leads WHERE phone_key = $1 AND status = 'MESSAGED'`, [lp.slice(-9)])).rowCount === 1, "pasados 25 min, se le escribe una sola vez", JSON.stringify(cr.lifecycle));
    check((await db.query(`SELECT 1 FROM notification_log WHERE kind = 'abandoned' AND detail LIKE $1`, [`%${lp}%`])).rowCount === 1, "el mensaje de recuperación queda anotado");
  } else check(true, "(fuera de horario de mensajes opcionales: se omite la recuperación)");

  console.log("\n4. «Vino» automático y premio por amiga");
  const refRow = (await db.query(`SELECT c.id, c.referral_code FROM customers c WHERE c.phone_key = $1`, [PH[0].slice(-9)])).rows[0];
  let code2 = refRow?.referral_code;
  if (!code2) { // se crea al abrir la página de la cita
    const bk = (await db.query(`SELECT code, hold_token FROM bookings WHERE customer_phone = $1 AND status = 'CONFIRMED' LIMIT 1`, [PH[0]])).rows[0];
    await fetch(`${BASE}/c/${bk.code}?t=${bk.hold_token.slice(0, 12)}`);
    code2 = (await db.query(`SELECT referral_code FROM customers WHERE phone_key = $1`, [PH[0].slice(-9)])).rows[0]?.referral_code;
  }
  check(/^[A-Z2-9]{6}$/.test(code2 ?? ""), "cada clienta tiene su código de amiga");
  const friend = phoneOf(9);
  await db.query(`INSERT INTO phone_otps (phone_key, code_hash, expires_at, used_at) VALUES ($1, 'x', now(), now())`, [friend.slice(-9)]); // ya verificada
  const hf = await hold(svc.id, slots[2], ip(6));
  const cf = await api("/api/bookings", { body: { holdId: hf.holdId, holdToken: hf.holdToken, name: "Growth Friend", phone: friend, attr: { sid: `gt_${run}_f`, ref: code2, flow: "full" } }, ip: ip(6) });
  await new Promise((r) => setTimeout(r, 1200));
  check(cf.status === 200 && (await db.query(`SELECT 1 FROM customers WHERE phone_key = $1 AND referred_by IS NOT NULL`, [friend.slice(-9)])).rowCount === 1, "la amiga queda anotada como «traída por»", JSON.stringify(cf.json?.error) + " hold=" + JSON.stringify(hf.error ?? hf.holdId));
  await db.query(`UPDATE bookings SET starts_at = now() - interval '6 hours', ends_at = now() - interval '5 hours', blocked_until = now() - interval '5 hours' WHERE code = $1`, [cf.json?.booking?.code]);
  await cron();
  const pair = (await db.query(`SELECT phone_key, referral_rewards, visit_count FROM customers WHERE phone_key IN ($1, $2)`, [friend.slice(-9), PH[0].slice(-9)])).rows;
  check(pair.length === 2 && pair.every((p) => p.referral_rewards >= 1), "tres horas después sin marcar nada cuenta como «vino» y las dos ganan su premio", JSON.stringify(pair));

  check((await db.query(`SELECT 1 FROM customers WHERE phone_key = $1 AND preferred_staff_id IS NOT NULL`, [friend.slice(-9)])).rowCount === 1, "tras venir, queda guardada su profesional habitual");

  console.log("\n5. Habilidades de las profesionales");
  const extra = (await db.query(`INSERT INTO staff (name, sort, active) VALUES ('Growth Staff', 98, true) RETURNING id`)).rows[0].id;
  try {
    const other = (await db.query(`SELECT id FROM services WHERE active AND id <> $1 ORDER BY id LIMIT 1`, [svc.id])).rows[0].id;
    await db.query(`INSERT INTO staff_services (staff_id, service_id) VALUES ($1, $2)`, [extra, other]);
    const staffIds = async (s) => [...new Set(((await api(`/api/availability?serviceId=${s}&from=${day(7)}&to=${day(7)}`, { method: "GET" })).json.slots ?? []).flatMap((x) => x.staffIds))];
    check(!(await staffIds(svc.id)).includes(extra), "quien solo hace otro servicio no aparece en los huecos de este");
    check((await staffIds(other)).includes(extra), "y sí aparece en los de su servicio");
  } finally {
    await db.query(`DELETE FROM staff WHERE id = $1`, [extra]);
  }

  console.log("\n6. Avisos a la dueña y resumen diario");
  const inbox = (await db.query(`SELECT count(*)::int AS n FROM admin_notifications WHERE kind = 'owner_new' AND title LIKE '%Growth%'`)).rows[0].n;
  check(inbox >= 1, "cada reserva nueva deja un aviso en la bandeja del panel", String(inbox));
  const isTest = (await db.query(`SELECT value FROM settings WHERE key = 'digest_hour'`)).rows[0]?.value;
  await db.query(`INSERT INTO settings (key, value) VALUES ('digest_enabled','on') ON CONFLICT (key) DO UPDATE SET value='on'`);
  await db.query(`INSERT INTO settings (key, value) VALUES ('digest_hour','0') ON CONFLICT (key) DO UPDATE SET value='0'`);
  await db.query(`DELETE FROM settings WHERE key IN ('last_digest')`);
  await db.query(`DELETE FROM settings WHERE key = 'last_digest_at'`);
  const cr2 = await cron();
  check(cr2.lifecycle?.digest === true, "a la hora elegida sale el resumen de reservas nuevas", JSON.stringify(cr2.lifecycle));
  check((await db.query(`SELECT 1 FROM admin_notifications WHERE kind = 'digest' AND at > now() - interval '2 minutes'`)).rowCount >= 1, "y queda en la bandeja del panel");
  const cr3 = await cron();
  check(cr3.lifecycle?.digest === false, "no se repite el mismo día");
  await db.query(`UPDATE settings SET value = $1 WHERE key = 'digest_hour'`, [isTest ?? "21"]);
} finally {
  const phones = `6880%`;
  await db.query(`DELETE FROM bookings WHERE customer_phone LIKE $1 OR customer_name LIKE 'Growth %'`, [phones]);
  await db.query(`DELETE FROM customers WHERE phone_key LIKE $1`, [phones]);
  await db.query(`DELETE FROM leads WHERE phone_key LIKE $1`, [phones]);
  await db.query(`DELETE FROM phone_otps WHERE phone_key LIKE $1`, [phones]);
  await db.query(`DELETE FROM funnel_events WHERE session_id LIKE 'gt\\_%'`);
  await db.query(`DELETE FROM notification_log WHERE detail LIKE '%6880%'`);
  await db.query(`DELETE FROM admin_notifications WHERE title LIKE '%Growth%' OR body LIKE '%6880%' OR (kind = 'digest' AND at > now() - interval '10 minutes')`);
  await db.end();
}
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} correctas, ${fail} con fallos`);
process.exit(fail === 0 ? 0 : 1);
