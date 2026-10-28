// Pruebas de tiempos de pose, recursos compartidos y bloques. Necesitan la web con PHONE_VERIFY=off y DISABLE_RATE_LIMITS=1
// (el servidor «prodiva-test» o:  PHONE_VERIFY=off DISABLE_RATE_LIMITS=1 npm run dev)   →   npm run test:phases
// ⚠️ Crea y borra servicios, recursos y una profesional «E2E-fases» en la base de datos de DATABASE_URL.
import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3102";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let pass = 0, fail = 0;
const check = (ok, msg, extra = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "✔" : "✘"} ${msg}${ok ? "" : "  " + extra}`); };
const section = (t) => console.log(`\n${t}`);
let ipn = 0;
const api = async (path, { method = "POST", body } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": `10.77.${Math.floor(++ipn / 250)}.${ipn % 250}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const slotsOf = async (svcId, d, staffId) => (await api(`/api/availability?serviceId=${svcId}&from=${d}&to=${d}${staffId ? `&staffId=${staffId}` : ""}`, { method: "GET" })).json.slots ?? [];
const mins = (iso, n) => new Date(new Date(iso).getTime() + n * 60000).toISOString();
const PHONE = (i) => `6770000${String(i).padStart(2, "0")}`;
let phoneN = 0;
async function book(svcId, startsAt, staffId, name = "Fases Test") {
  const h = await api("/api/holds", { body: { serviceId: svcId, startsAt, staffId } });
  if (h.status !== 200) return { hold: h };
  const c = await api("/api/bookings", { body: { holdId: h.json.holdId, holdToken: h.json.holdToken, name, phone: PHONE(++phoneN) } });
  return { hold: h, confirm: c, booking: c.json?.booking };
}

const created = { services: [], staff: null, resources: [] };
try {
  const staff1 = (await db.query(`SELECT id FROM staff WHERE active AND name <> 'E2E-fases' ORDER BY sort, id LIMIT 1`)).rows[0].id;
  const staff2 = (await db.query(`INSERT INTO staff (name, sort, active) VALUES ('E2E-fases', 97, true) RETURNING id`)).rows[0].id;
  created.staff = staff2;
  const svc = async (slug, name, dur, step) => {
    const r = await db.query(`INSERT INTO services (slug, name, category, duration_min, price_cents, slot_step_min, sort) VALUES ($1, $2, 'E2E fases', $3, 4000, $4, 998) RETURNING id`, [slug, name, dur, step]);
    created.services.push(r.rows[0].id);
    return r.rows[0].id;
  };
  const tinte = await svc("e2e-tinte", "E2E Tinte", 105, 15);
  await db.query(`INSERT INTO service_phases VALUES ($1,0,'active',30), ($1,1,'wait',45), ($1,2,'active',30)`, [tinte]);
  const corto = await svc("e2e-corto", "E2E Corte corto", 30, 15);
  const laser = await svc("e2e-laser", "E2E Láser", 30, 30);
  await db.query(`INSERT INTO service_resources (service_id, kind, uses) VALUES ($1, 'e2e-laser', 'all')`, [laser]);
  const unit = (await db.query(`INSERT INTO resources (name, kind) VALUES ('E2E Láser 1', 'e2e-laser') RETURNING id`)).rows[0].id;
  created.resources.push(unit);

  // Un día laborable con huecos
  let D = null, T = null;
  for (let n = 9; n < 25 && !T; n++) {
    const s = (await slotsOf(tinte, day(n), staff1)).filter((x) => x.available);
    const base = s.find((x) => x.time >= "10:00" && x.time <= "11:00");
    if (base) { D = day(n); T = base.startsAt; }
  }
  check(!!T, "hay un día con huecos para un tinte de 1 h 45 (incluye 45 min de pose)");

  section("0. El esquema");
  const oldLock = (await db.query(`SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap_v2'`)).rowCount;
  check(oldLock === 0, "el candado antiguo (toda la cita) no existe: lo sustituyen los bloques", String(oldLock));

  section("1. La profesional queda libre durante la pose");
  const A = await book(tinte, T, staff1);
  check(A.confirm?.status === 200, "se reserva el tinte A", JSON.stringify(A.confirm?.json?.error ?? A.hold?.json?.error));
  const blocksA = (await db.query(`SELECT count(*)::int AS n FROM booking_blocks WHERE booking_id = (SELECT id FROM bookings WHERE code = $1) AND staff_id = $2 AND live`, [A.booking?.code, staff1])).rows[0].n;
  check(blocksA === 2, "la cita ocupa dos tramos de la profesional (al principio y al final), no uno continuo", String(blocksA));
  const sl = (iso, svcId = corto) => slotsOf(svcId, D, staff1).then((r) => r.find((x) => x.startsAt === iso));
  check((await sl(mins(T, 30)))?.available === true, "un corte de 30 min cabe justo durante la pose del tinte A");
  check((await sl(mins(T, 15)))?.available === false, "pero no si empieza antes de que A termine de aplicar el tinte");
  check((await sl(mins(T, 75)))?.available === false, "ni cuando A vuelve a actuar para aclarar");
  check((await sl(mins(T, 105)))?.available === true, "y sí en cuanto A termina");
  const Bt = await book(tinte, mins(T, 30), staff1);
  const rowB = (await slotsOf(tinte, D, staff1)).find((x) => x.startsAt === mins(T, 30));
  check(Bt.confirm?.status === 200, "un segundo tinte B entra en la pose de A (sus tramos encajan entre los de A)", JSON.stringify(Bt.confirm?.json?.error ?? Bt.hold?.json?.error) + ` D=${D} T=${T} fila=${JSON.stringify(rowB)}`);
  const Ct = await api("/api/holds", { body: { serviceId: tinte, startsAt: mins(T, 15), staffId: staff1 } });
  check(Ct.status === 409 && Ct.json?.error?.code === "SLOT_TAKEN", "un tinte C que pisaría los tramos de A o B se rechaza", String(Ct.status));

  section("2. El candado es de la base de datos (carrera)");
  const T2 = (await slotsOf(tinte, D, staff1)).filter((x) => x.available).map((x) => x.startsAt).find((x) => new Date(x) > new Date(mins(T, 135)));
  const race = await Promise.all(Array.from({ length: 6 }, () => api("/api/holds", { body: { serviceId: tinte, startsAt: T2, staffId: staff1 } })));
  const win = race.filter((r) => r.status === 200), lose = race.filter((r) => r.status === 409);
  check(win.length === 1 && lose.length === 5, `seis personas pulsan el mismo hueco: 1 gana y 5 «ocupado» (ganan ${win.length}, ocupado ${lose.length})`);
  for (const w of win) await api(`/api/holds/${w.json.holdId}?token=${w.json.holdToken}`, { method: "DELETE" });
  const overlap = (await db.query(`SELECT count(*)::int AS n FROM booking_blocks a JOIN booking_blocks b ON a.id < b.id AND a.staff_id = b.staff_id AND a.live AND b.live AND a.during && b.during`)).rows[0].n;
  check(overlap === 0, "en toda la base de datos no hay dos bloques vivos de la misma profesional que se solapen", String(overlap));

  section("3. Contra un modelo de referencia escrito aparte");
  const hours = (await db.query(`SELECT to_char(open_time,'HH24:MI') AS o, to_char(close_time,'HH24:MI') AS c, to_char(break_start,'HH24:MI') AS bs, to_char(break_end,'HH24:MI') AS be FROM business_hours WHERE weekday = EXTRACT(DOW FROM $1::date)::int`, [D])).rows[0];
  const tz = (hhmm) => new Date(new Date(`${D}T${hhmm}:00Z`).getTime() - (Number((await_tz_offset(D)) ?? 0)) * 60000);
  function await_tz_offset(d) { // minutos de diferencia Madrid-UTC ese día
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(`${d}T12:00:00Z`));
    const [h, m] = f.split(":").map(Number);
    return (h * 60 + m) - 12 * 60;
  }
  const win1 = [[hours.o, hours.bs ?? hours.c]]; if (hours.bs) win1.push([hours.be, hours.c]);
  const work = win1.map(([a, b]) => [tz(a).getTime(), tz(b).getTime()]);
  const live = (await db.query(`SELECT lower(bb.during) AS a, upper(bb.during) AS b FROM booking_blocks bb JOIN bookings k ON k.id = bb.booking_id WHERE bb.staff_id = $1 AND bb.live AND (k.status = 'CONFIRMED' OR (k.status = 'HOLD' AND k.hold_expires_at > now()))`, [staff1])).rows.map((r) => [new Date(r.a).getTime(), new Date(r.b).getTime()]);
  const segs = [[0, 30], [75, 105]];
  let wrong = 0, total = 0;
  const api1 = await slotsOf(tinte, D, staff1);
  for (const s of api1) {
    const t = new Date(s.startsAt).getTime();
    const inside = segs.every(([o, e]) => work.some(([wa, wb]) => wa <= t + o * 60000 && t + e * 60000 <= wb));
    const free = segs.every(([o, e]) => !live.some(([a, b]) => a < t + e * 60000 && t + o * 60000 < b));
    const expected = inside && free && t > Date.now() + 120 * 60000;
    total++;
    if (expected !== s.available) wrong++;
  }
  check(total > 10 && wrong === 0, `el SQL y el modelo en JS coinciden en los ${total} inicios del día (diferencias: ${wrong})`);

  section("4. Recursos compartidos (una sola máquina, dos profesionales)");
  const free1 = (await slotsOf(laser, D, staff1)).filter((x) => x.available).map((x) => x.startsAt);
  const free2 = new Set((await slotsOf(laser, D, staff2)).filter((x) => x.available).map((x) => x.startsAt));
  // una hora con la máquina libre y otra justo detrás (que no caiga en la pausa del mediodía)
  const Ls = free1.find((x) => new Date(x) > new Date(mins(T, 200)) && free2.has(x) && free2.has(mins(x, 30)));
  const L1 = await book(laser, Ls, staff1);
  check(L1.confirm?.status === 200, "se reserva el láser con la profesional 1", JSON.stringify(L1.confirm?.json?.error ?? L1.hold?.json?.error));
  const st2 = (await slotsOf(laser, D, staff2)).find((x) => x.startsAt === Ls);
  check(st2?.available === false, "a la misma hora la otra profesional está libre pero la máquina no: no se ofrece el hueco");
  const L2 = await api("/api/holds", { body: { serviceId: laser, startsAt: Ls, staffId: staff2 } });
  check(L2.status === 409, "y aunque se fuerce, el candado de la máquina lo impide", String(L2.status));
  const L3 = await api("/api/holds", { body: { serviceId: laser, startsAt: mins(Ls, 30), staffId: staff2 } });
  check(L3.status === 200, "justo después la máquina vuelve a estar libre", JSON.stringify(L3.json?.error ?? L3.status));
  if (L3.json?.holdId) await api(`/api/holds/${L3.json.holdId}?token=${L3.json.holdToken}`, { method: "DELETE" });
  await db.query(`UPDATE resources SET active = false WHERE id = $1`, [unit]);
  check(((await slotsOf(laser, D, staff1)).filter((x) => x.available)).length === 0, "sin unidades activas del recurso, el servicio no ofrece huecos");
  await db.query(`UPDATE resources SET active = true WHERE id = $1`, [unit]);

  section("5. Cambiar la hora y cancelar");
  const Anew = (await slotsOf(tinte, D, staff1)).filter((x) => x.available).map((x) => x.startsAt).find((x) => new Date(x) > new Date(mins(T, 300)));
  const rs = await api(`/api/bookings/${A.booking.code}/reschedule`, { body: { token: A.booking.token, startsAt: Anew } });
  check(rs.status === 200, "se cambia la hora de una cita con pose", JSON.stringify(rs.json?.error));
  const nb = (await db.query(`SELECT lower(during) AS a FROM booking_blocks WHERE booking_id = (SELECT id FROM bookings WHERE code = $1) AND staff_id = $2 AND live ORDER BY lower(during)`, [A.booking.code, staff1])).rows;
  check(nb.length === 2 && new Date(nb[0].a).toISOString() === Anew && new Date(nb[1].a).getTime() === new Date(Anew).getTime() + 75 * 60000, "sus bloques se recolocan con el mismo dibujo (actúa · pose · actúa)");
  // el hueco antiguo de A queda libre salvo lo que ocupa B (que está dentro de su pose): a T mismo ya cabe un corte
  check((await sl(T))?.available === true, "el hueco antiguo se libera para otras clientas");
  await api(`/api/respond`, { body: { code: A.booking.code, token: A.booking.token, action: "cancel" } });
  const liveA = (await db.query(`SELECT count(*)::int AS n FROM booking_blocks WHERE booking_id = (SELECT id FROM bookings WHERE code = $1) AND live`, [A.booking.code])).rows[0].n;
  check(liveA === 0, "al cancelar, todos sus bloques se liberan");
  const addable = await api(`/api/bookings/${Bt.booking.code}/extras?t=${Bt.booking.token}`, { method: "GET" });
  check(addable.status === 200 && (addable.json?.options ?? addable.json?.services ?? []).length === 0, "a una cita con pose no se le ofrece «añadir un servicio» desde el móvil", JSON.stringify(addable.json).slice(0, 80));
} finally {
  await db.query(`DELETE FROM bookings WHERE customer_phone LIKE '6770000%' OR customer_name = 'Fases Test' OR service_id = ANY($1::int[])`, [created.services]);
  await db.query(`DELETE FROM customers WHERE phone_key LIKE '6770000%'`);
  if (created.services.length) await db.query(`DELETE FROM services WHERE id = ANY($1::int[])`, [created.services]);
  if (created.resources.length) await db.query(`DELETE FROM resources WHERE id = ANY($1::int[])`, [created.resources]);
  if (created.staff) await db.query(`DELETE FROM staff WHERE id = $1`, [created.staff]);
  await db.end();
}
console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} correctas, ${fail} con fallos`);
process.exit(fail === 0 ? 0 : 1);
