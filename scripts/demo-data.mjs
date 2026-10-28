// Datos de DEMOSTRACIÓN para ver el panel «vivo» en local (no uses esto en producción).
//   npm run demo:seed    → crea ~5 semanas de citas, visitas a la web, abandonos y clientas ficticias
//   npm run demo:clear   → lo borra (solo toca lo marcado como demo: teléfonos 6990000xx y sesiones demo_*)
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");
if (/vercel|neon|amazonaws|supabase/i.test(url) && process.env.I_KNOW !== "1") throw new Error("Esto es solo para bases de datos locales.");
const db = new pg.Client({ connectionString: url });
await db.connect();

async function clear() {
  await db.query(`DELETE FROM service_resources WHERE service_id IN (SELECT id FROM services WHERE slug LIKE 'laser-%') AND kind = 'laser'`);
  await db.query(`DELETE FROM resources WHERE name LIKE '%(demo)'`);
  await db.query(`DELETE FROM service_phases WHERE service_id IN (SELECT id FROM services WHERE slug = 'lifting-pestanas')`);
  await db.query(`DELETE FROM bookings WHERE customer_phone LIKE '699000%'`);
  await db.query(`DELETE FROM customers WHERE phone_key LIKE '699000%'`);
  await db.query(`DELETE FROM leads WHERE phone_key LIKE '699000%'`);
  await db.query(`DELETE FROM funnel_events WHERE session_id LIKE 'demo_%'`);
  await db.query(`DELETE FROM notification_log WHERE booking_id IS NULL AND detail LIKE '%699000%'`);
}
await clear();
if (process.argv[2] === "clear") {
  console.log("Datos de demostración borrados.");
  await db.end();
  process.exit(0);
}

// Ejemplos de las funciones nuevas: lifting con pose (actúa · espera · actúa) y una sola cabina de láser compartida
await db.query(`INSERT INTO service_phases (service_id, position, kind, minutes) SELECT id, p.pos, p.kind, p.m FROM services, (VALUES (0,'active',20),(1,'wait',25),(2,'active',15)) AS p(pos, kind, m) WHERE slug = 'lifting-pestanas' AND duration_min = 60 ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO resources (name, kind) VALUES ('Cabina láser (demo)', 'laser')`);
await db.query(`INSERT INTO service_resources (service_id, kind, uses) SELECT id, 'laser', 'all' FROM services WHERE slug LIKE 'laser-%' ON CONFLICT DO NOTHING`);

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const services = (await db.query(`SELECT id, name, duration_min, price_cents, slug FROM services WHERE active ORDER BY sort, id`)).rows;
const staff = (await db.query(`SELECT id FROM staff WHERE active ORDER BY sort, id LIMIT 1`)).rows[0].id;
const names = ["Lucía", "Carmen", "Marta", "Paula", "Sara", "Elena", "Noa", "Irene", "Alba", "Laura", "Uxía", "Brais", "Antía", "Rocío", "Sonia", "Nuria", "Eva", "Julia", "Clara", "Andrea"];
const sources = [["instagram", 38], ["google", 26], [null, 22], ["amiga", 8], ["recovery", 4], ["seo", 2]];
const pickSource = () => { let r = rnd() * 100; for (const [s, w] of sources) { if ((r -= w) < 0) return s; } return null; };

// Clientas
const customers = [];
for (let i = 0; i < 24; i++) {
  const phone = `699000${String(i).padStart(3, "0")}`;
  const c = (await db.query(
    `INSERT INTO customers (phone_key, name, phone, no_show_count, visit_count, created_at) VALUES ($1, $2, $3, 0, 0, now() - make_interval(days => $4::int)) RETURNING id`,
    [phone, `${names[i % names.length]} Demo`, phone, 5 + Math.floor(rnd() * 80)],
  )).rows[0].id;
  customers.push({ id: c, phone, name: `${names[i % names.length]} Demo` });
}

// Citas: de hace 35 días a dentro de 7, sin solaparse (una profesional)
let made = 0;
for (let d = -35; d <= 7; d++) {
  const day = new Date(); day.setDate(day.getDate() + d); day.setHours(0, 0, 0, 0);
  const dow = day.getDay();
  if (dow === 0) continue;
  const slots = dow === 6 ? [10, 11, 12, 13] : [10, 11, 12, 13, 16, 17, 18, 19];
  const n = 2 + Math.floor(rnd() * (dow === 6 ? 3 : 5));
  const hours = [...slots].sort(() => rnd() - 0.5).slice(0, n);
  for (const h of hours) {
    const svc = pick(services.filter((s) => s.duration_min <= 60));
    const cust = pick(customers);
    const start = new Date(day); start.setHours(h, pick([0, 0, 30]), 0, 0);
    const end = new Date(start.getTime() + svc.duration_min * 60000);
    const past = end.getTime() < Date.now();
    const roll = rnd();
    const status = roll < 0.07 ? "CANCELLED" : "CONFIRMED";
    const attendance = past && status === "CONFIRMED" ? (rnd() < 0.08 ? "NO_SHOW" : "SHOWED") : null;
    const source = pickSource();
    try {
      const b = (await db.query(
        `INSERT INTO bookings (code, staff_id, service_id, starts_at, ends_at, blocked_until, status, hold_token, customer_name, customer_phone, customer_id, source, confirmed_at, attendance, attended_at, utm_source, session_id, cancelled_at, cancel_reason)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, 'web', $4::timestamptz - interval '3 days', $11, CASE WHEN $11::text IS NULL THEN NULL ELSE $5::timestamptz END, $12, $13, CASE WHEN $6 = 'CANCELLED' THEN $4::timestamptz - interval '2 days' END, CASE WHEN $6 = 'CANCELLED' THEN 'customer' END)
         RETURNING id`,
        [`DEMO${String(made).padStart(4, "0")}`, staff, svc.id, start, end, status, `demo-${made}-${"x".repeat(30)}`, cust.name, cust.phone, cust.id, attendance, source, `demo_${made}`],
      )).rows[0].id;
      await db.query(`INSERT INTO booking_services (booking_id, service_id, position, name, duration_min, price_cents) VALUES ($1, $2, 0, $3, $4, $5)`, [b, svc.id, svc.name, svc.duration_min, svc.price_cents]);
      if (attendance === "SHOWED") await db.query(`UPDATE customers SET visit_count = visit_count + 1 WHERE id = $1`, [cust.id]);
      if (attendance === "NO_SHOW") await db.query(`UPDATE customers SET no_show_count = no_show_count + 1 WHERE id = $1`, [cust.id]);
      made++;
    } catch (e) {
      if (e.code !== "23P01") throw e; // solape: se salta
    }
  }
}

// Embudo: ~420 visitas con su recorrido (con fugas reales en cada paso)
const steps = [["landing", 1], ["service", 0.62], ["slots", 0.85], ["hold", 0.52], ["details", 0.9], ["lead", 0.55], ["confirmed", 0.58]];
let sessions = 0;
for (let i = 0; i < 420; i++) {
  const sid = `demo_${i}`;
  const src = pickSource();
  const mobile = rnd() < 0.78;
  const at = new Date(Date.now() - rnd() * 29 * 86400000);
  let alive = true;
  for (const [ev, keep] of steps) {
    if (ev === "lead") {
      if (!alive || rnd() > (mobile ? 0.5 : 0.62)) continue;
    } else {
      if (!alive) break;
      if (ev !== "landing" && rnd() > keep * (mobile ? 0.94 : 1.06)) { alive = false; continue; }
    }
    await db.query(
      `INSERT INTO funnel_events (session_id, event, flow, utm_source, device, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [sid, ev, mobile && rnd() < 0.3 ? "easy" : "full", src, mobile ? "mobile" : "desktop", new Date(at.getTime() + sessions * 1000)],
    );
    sessions++;
  }
}

// Reservas a medias recuperadas
for (let i = 0; i < 9; i++) {
  const phone = `699000${String(100 + i)}`;
  const s = pick(["NEW", "MESSAGED", "MESSAGED", "BOOKED", "BOOKED", "EXPIRED"]);
  await db.query(
    `INSERT INTO leads (phone, phone_key, name, service_ids, service_label, starts_at, status, messaged_at, created_at) VALUES ($1, $1, $2, ARRAY[$3::int], $4, now() + interval '3 days', $5, CASE WHEN $5 IN ('MESSAGED','BOOKED') THEN now() - interval '1 day' END, now() - make_interval(days => $6::int))`,
    [phone, `${pick(names)} Demo`, services[0].id, services[0].name, s, Math.floor(rnd() * 20)],
  );
}
console.log(`Listo: ${made} citas, ${sessions} eventos del embudo y 9 contactos recuperables (todo marcado como demo).`);
await db.end();
