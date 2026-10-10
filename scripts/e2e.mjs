// Pruebas de extremo a extremo del sistema de reservas, contra una instancia en marcha.
//
//   docker compose up -d --build
//   DATABASE_URL=postgres://prodiva:prodiva@localhost:5433/prodiva BASE_URL=http://localhost:3100 npm run test:e2e
//
// ⚠️ Crea y cancela citas reales llamadas "E2E Test" en esa base de datos (y las borra al terminar).
import pg from "pg";

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const TZ = process.env.SALON_TIMEZONE ?? "Europe/Madrid";
const REMIND_H = Number(process.env.REMINDER_HOURS_BEFORE ?? 4);
const MIN_NOTICE = Number(process.env.MIN_NOTICE_MIN ?? 120);

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL (la misma base de datos que usa la web).");
  process.exit(2);
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let pass = 0;
let fail = 0;
const check = (cond, msg, extra = "") => {
  if (cond) {
    pass++;
    console.log("  ✔", msg);
  } else {
    fail++;
    console.error("  ✘", msg, extra);
  }
};
const section = (t) => console.log(`\n${t}`);

let ipN = 10;
const freshIp = () => `10.77.${Math.floor(ipN / 250)}.${ipN++ % 250}`;

async function api(path, { method = "GET", body, ip } = {}) {
  const headers = { "content-type": "application/json" };
  if (ip) headers["x-forwarded-for"] = ip;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: r.status, json };
}

const todayStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
const dow = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
};
const mins = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const localParts = (d) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
};
const localDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const overlaps = (aStart, aDur, bStart, bDur) => {
  const a = new Date(aStart).getTime();
  const b = new Date(bStart).getTime();
  return a < b + bDur * 60000 && b < a + aDur * 60000;
};

// ---------- datos de la base de datos ----------
const services = (
  await db.query(`SELECT id, name, duration_min, COALESCE(slot_step_min, duration_min) AS step_min FROM services WHERE active ORDER BY duration_min, id`)
).rows;
const hours = new Map(
  (
    await db.query(`SELECT weekday, closed, to_char(open_time,'HH24:MI') AS open, to_char(close_time,'HH24:MI') AS close,
                           to_char(break_start,'HH24:MI') AS bs, to_char(break_end,'HH24:MI') AS be FROM business_hours`)
  ).rows.map((h) => [h.weekday, h]),
);
if (!services.length) {
  console.error("No hay servicios activos: ¿se ejecutó la migración?");
  process.exit(2);
}

const staff = (await db.query(`SELECT id FROM staff WHERE active`)).rows;
const mode = (await db.query(`SELECT value FROM settings WHERE key = 'slot_mode'`)).rows[0]?.value ?? process.env.SLOT_MODE ?? "smart";
const minRest = Math.min(60, Math.max(5, Number((await db.query(`SELECT COALESCE(MIN(duration_min),15) AS m FROM services WHERE active`)).rows[0].m)));
console.log(`Modo de huecos: ${mode} · resto mínimo: ${minRest} min · ${services.length} servicios · ${staff.length} profesional(es)`);

// ---- zona horaria sin librerías ----
const tzOffsetMs = (epoch) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(epoch));
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - epoch;
};
const zoned = (day, hhmm) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let e = guess - tzOffsetMs(guess);
  e = guess - tzOffsetMs(e);
  return e;
};
const hhmmOf = (ms) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms));
  return `${p.find((x) => x.type === "hour").value}:${p.find((x) => x.type === "minute").value}`;
};

/**
 * MODELO DE REFERENCIA, escrito aparte de la consulta SQL: calcula qué horas deberían estar libres
 * para un servicio y un día, con las mismas reglas (tramos libres, rejilla anclada, restos mínimos).
 * Si coincide con lo que devuelve la web, la consulta SQL hace lo que dice.
 */
async function referenceTimes(svc, day) {
  const h = hours.get(dow(day));
  if (!h || h.closed) return new Set();
  const blocks = (h.bs ? [[h.open, h.bs], [h.be, h.close]] : [[h.open, h.close]]).map(([a, b]) => [zoned(day, a), zoned(day, b)]);
  const dayStart = zoned(day, "00:00") - 3600000;
  const dayEnd = zoned(addDays(day, 1), "00:00") + 3600000;
  const bookings = (
    await db.query(
      `SELECT staff_id, starts_at, ends_at FROM bookings
       WHERE (status = 'CONFIRMED' OR (status = 'HOLD' AND hold_expires_at > now())) AND starts_at < $2 AND ends_at > $1`,
      [new Date(dayStart), new Date(dayEnd)],
    )
  ).rows;
  const off = (await db.query(`SELECT staff_id, starts_at, ends_at FROM time_off WHERE starts_at < $2 AND ends_at > $1`, [new Date(dayStart), new Date(dayEnd)])).rows;
  const D = svc.duration_min * 60000;
  const S = Math.max(5, svc.step_min) * 60000;
  const M = minRest * 60000;
  const gapOk = (before, after) => (before === 0 || before >= M) && (after === 0 || after >= M);
  const out = new Set();
  const limit = Date.now() + MIN_NOTICE * 60000;

  for (const st of staff) {
    const busy = [...bookings.filter((b) => b.staff_id === st.id), ...off.filter((t) => t.staff_id === null || t.staff_id === st.id)]
      .map((x) => [+new Date(x.starts_at), +new Date(x.ends_at)])
      .sort((a, b) => a[0] - b[0]);
    for (const [bs, be] of blocks) {
      const wins = [];
      let cur = bs;
      for (const [a, b] of busy) {
        if (b <= cur || a >= be) continue;
        if (a > cur) wins.push([cur, a]);
        cur = Math.max(cur, b);
        if (cur >= be) break;
      }
      if (cur < be) wins.push([cur, be]);
      const offered = new Set();
      if (mode !== "compact") {
        for (let t = bs; t + D <= be; t += S) {
          const w = wins.find(([a, b]) => a <= t && t + D <= b);
          if (w && (mode === "flex" || gapOk(t - w[0], w[1] - (t + D)))) offered.add(t);
        }
      }
      if (mode !== "flex") {
        for (const [wa, wb] of wins) {
          for (let t = wa; t + D <= wb; t += S) if (gapOk(t - wa, wb - (t + D))) offered.add(t);
          if (wb - wa >= D && gapOk(wb - D - wa, 0)) offered.add(wb - D);
        }
      }
      for (const t of offered) if (t > limit) out.add(hhmmOf(t));
    }
  }
  return out;
}

/** Compara, para todos los servicios, lo que ofrece la web con el modelo de referencia. */
async function compareDay(day, label) {
  let bad = 0;
  const notes = [];
  for (const s of services) {
    const api = new Set((await slotsFor(s.id, day)).filter((x) => x.available).map((x) => x.time));
    const ref = await referenceTimes(s, day);
    // se ignoran los huecos pegados al límite del preaviso (el reloj avanza entre las dos consultas)
    const edge = (t) => Math.abs(zoned(day, t) - (Date.now() + MIN_NOTICE * 60000)) < 120000;
    const onlyApi = [...api].filter((t) => !ref.has(t) && !edge(t));
    const onlyRef = [...ref].filter((t) => !api.has(t) && !edge(t));
    if (onlyApi.length || onlyRef.length) {
      bad++;
      notes.push(`${s.name}: solo en la web [${onlyApi.join(" ")}] · solo en el modelo [${onlyRef.join(" ")}]`);
    }
  }
  check(bad === 0, `${label}: la web coincide con el modelo de referencia en los ${services.length} servicios`, "\n      " + notes.join("\n      "));
}

const from = todayStr();
const slotsFor = async (serviceId, day, to = day) =>
  (await api(`/api/availability?serviceId=${serviceId}&from=${day}&to=${to}`)).json?.slots ?? [];

try {
  /* 1 ---------------------------------------------------------------- */
  section("1. Los huecos de cada servicio coinciden con el modelo de referencia (próximos 7 días)");
  for (let i = 0; i < 7; i++) await compareDay(addDays(from, i), addDays(from, i));

  /* 2 ---------------------------------------------------------------- */
  section("2. Preaviso mínimo: no se ofrecen huecos que empiezan demasiado pronto");
  for (const s of services) {
    const slots = await slotsFor(s.id, from, addDays(from, 1));
    const early = slots.filter((x) => new Date(x.startsAt).getTime() < Date.now() + MIN_NOTICE * 60000 - 60000);
    check(early.length === 0, `${s.name}: ${early.length} huecos dentro del preaviso`);
  }

  /* 3 ---------------------------------------------------------------- */
  section("3. Ciclo completo: bloquear → confirmar → cancelar → vuelve a estar libre");
  const A = services[0]; // servicio más corto
  const free = (await slotsFor(A.id, addDays(from, 3), addDays(from, 16))).filter((x) => x.available);
  if (free.length < 2) {
    check(false, "No hay al menos 2 huecos libres en los próximos días para probar");
  } else {
    const slot = free[0];
    const holdBody = { serviceId: A.id, staffId: null, startsAt: slot.startsAt };

    const h1 = await api("/api/holds", { method: "POST", body: holdBody, ip: freshIp() });
    check(h1.status === 200 && h1.json?.holdId, "se puede bloquear un hueco libre", JSON.stringify(h1));

    let av = await slotsFor(A.id, slot.day);
    check(av.find((x) => x.startsAt === slot.startsAt)?.available === false, "el hueco bloqueado aparece ocupado para los demás");

    const h2 = await api("/api/holds", { method: "POST", body: holdBody, ip: freshIp() });
    check(h2.status === 409 && h2.json?.error?.code === "SLOT_TAKEN", "un segundo cliente no puede bloquear el mismo hueco", JSON.stringify(h2));

    await api(`/api/holds/${h1.json.holdId}?token=${h1.json.holdToken}`, { method: "DELETE" });
    av = await slotsFor(A.id, slot.day);
    check(av.find((x) => x.startsAt === slot.startsAt)?.available === true, "al soltar el bloqueo, el hueco vuelve a estar libre");

    const h3 = await api("/api/holds", { method: "POST", body: holdBody, ip: freshIp() });
    const conf = await api("/api/bookings", {
      method: "POST",
      body: { holdId: h3.json?.holdId, holdToken: h3.json?.holdToken, name: "E2E Test", phone: "600000000" },
    });
    const bk = conf.json?.booking;
    check(conf.status === 200 && bk?.code, "se confirma la cita", JSON.stringify(conf));
    if (bk) {
      check((new Date(bk.endsAt) - new Date(bk.startsAt)) / 60000 === A.duration_min, `la cita dura exactamente ${A.duration_min} min`);

      av = await slotsFor(A.id, slot.day);
      check(av.find((x) => x.startsAt === slot.startsAt)?.available === false, "tras confirmar, el hueco sigue ocupado");

      await compareDay(slot.day, "con la cita confirmada");

      let overlapBad = 0;
      for (const s of services) {
        const list = await slotsFor(s.id, slot.day);
        overlapBad += list.filter((x) => x.available && overlaps(x.startsAt, s.duration_min, bk.startsAt, A.duration_min)).length;
      }
      check(overlapBad === 0, "ningún servicio ofrece huecos que solapen con la cita (30/45/60/120 min…)", `${overlapBad} solapes`);

      // recordatorio programado
      const row = (await db.query(`SELECT starts_at, remind_at FROM bookings WHERE code = $1`, [bk.code])).rows[0];
      const start = new Date(row.starts_at);
      const early = new Date(start.getTime() - REMIND_H * 3600000);
      if (localParts(early) >= 8 * 60 + 30) {
        check(row.remind_at && Math.abs(new Date(row.remind_at) - early) < 1500, `recordatorio programado ${REMIND_H} h antes`);
      } else {
        const r = row.remind_at ? new Date(row.remind_at) : null;
        check(r && localParts(r) === 19 * 60 && localDay(r) === addDays(localDay(start), -1), "cita temprana: recordatorio la tarde anterior a las 19:00");
      }

      // lista de espera (apuntarse y duplicados)
      const w1 = await api("/api/waitlist", { method: "POST", ip: freshIp(), body: { serviceId: A.id, day: slot.day, name: "E2E Test", phone: "600000001" } });
      check(w1.status === 200 && w1.json?.already === false, "se puede apuntar a la lista de espera");
      const w2 = await api("/api/waitlist", { method: "POST", ip: freshIp(), body: { serviceId: A.id, day: slot.day, name: "E2E Test", phone: "600000001" } });
      check(w2.status === 200 && w2.json?.already === true, "apuntarse dos veces no duplica");

      // cancelar desde el recordatorio
      const cx = await api("/api/respond", { method: "POST", body: { code: bk.code, token: bk.token, action: "cancel" } });
      check(cx.status === 200 && cx.json?.state === "cancelled", "la clienta cancela con un toque", JSON.stringify(cx));
      const st = (await db.query(`SELECT status FROM bookings WHERE code = $1`, [bk.code])).rows[0];
      check(st?.status === "CANCELLED", "la cita queda CANCELLED en la base de datos");

      av = await slotsFor(A.id, slot.day);
      check(av.find((x) => x.startsAt === slot.startsAt)?.available === true, "al cancelar, el hueco se habilita de nuevo");
      await compareDay(slot.day, "tras cancelar");

      const again = await api("/api/respond", { method: "POST", body: { code: bk.code, token: bk.token, action: "cancel" } });
      check(again.status === 200 && again.json?.state === "already_cancelled", "cancelar dos veces es inofensivo");

      // volver a reservar el mismo hueco
      const h4 = await api("/api/holds", { method: "POST", body: holdBody, ip: freshIp() });
      const c4 = await api("/api/bookings", { method: "POST", body: { holdId: h4.json?.holdId, holdToken: h4.json?.holdToken, name: "E2E Test", phone: "600000000" } });
      check(c4.status === 200, "el hueco liberado se puede reservar otra vez", JSON.stringify(c4));
      if (c4.json?.booking) await api("/api/respond", { method: "POST", body: { code: c4.json.booking.code, token: c4.json.booking.token, action: "cancel" } });
    }

    /* 4 -------------------------------------------------------------- */
    section("4. Carrera: seis personas pulsan el mismo hueco a la vez");
    const target = free[1];
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceId: A.id, staffId: null, startsAt: target.startsAt } }),
      ),
    );
    const winners = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status === 409);
    check(winners.length === 1 && losers.length === 5, `exactamente 1 ganadora y 5 con "hueco ocupado" (ganadoras: ${winners.length}, ocupado: ${losers.length})`);
    for (const w of winners) await api(`/api/holds/${w.json.holdId}?token=${w.json.holdToken}`, { method: "DELETE" });
  }
} finally {
  await db.query(`DELETE FROM bookings WHERE customer_name = 'E2E Test'`);
  await db.query(`DELETE FROM waitlist WHERE name = 'E2E Test'`);
  await db.end();
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} correctas, ${fail} con fallos`);
process.exit(fail === 0 ? 0 : 1);
