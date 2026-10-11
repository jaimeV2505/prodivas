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
  await db.query(`SELECT id, name, duration_min, buffer_min, COALESCE(slot_step_min, duration_min) AS step_min FROM services WHERE active ORDER BY duration_min, id`)
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
const staffHours = new Map(
  (
    await db.query(`SELECT staff_id, weekday, closed, to_char(open_time,'HH24:MI') AS open, to_char(close_time,'HH24:MI') AS close,
                           to_char(break_start,'HH24:MI') AS bs, to_char(break_end,'HH24:MI') AS be FROM staff_hours`)
  ).rows.map((h) => [`${h.staff_id}:${h.weekday}`, h]),
);
/** Horario efectivo de una profesional un día (el suyo si lo tiene; el del salón si no). */
const effHours = (staffId, weekday) => {
  const h = hours.get(weekday);
  if (!h || h.closed) return null;
  const sh = staffHours.get(`${staffId}:${weekday}`);
  if (!sh) return h;
  return sh.closed || !sh.open || !sh.close ? null : sh;
};
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
  const dayStart = zoned(day, "00:00") - 3600000;
  const dayEnd = zoned(addDays(day, 1), "00:00") + 3600000;
  const bookings = (
    await db.query(
      `SELECT staff_id, starts_at, blocked_until AS ends_at FROM bookings
       WHERE (status = 'CONFIRMED' OR (status = 'HOLD' AND hold_expires_at > now())) AND starts_at < $2 AND blocked_until > $1`,
      [new Date(dayStart), new Date(dayEnd)],
    )
  ).rows;
  const off = (await db.query(`SELECT staff_id, starts_at, ends_at FROM time_off WHERE starts_at < $2 AND ends_at > $1`, [new Date(dayStart), new Date(dayEnd)])).rows;
  const D = (svc.duration_min + svc.buffer_min) * 60000; // lo que ocupa: servicio + limpieza
  const S = Math.max(5, svc.step_min) * 60000;
  const M = minRest * 60000;
  const gapOk = (before, after) => (before === 0 || before >= M) && (after === 0 || after >= M);
  const out = new Set();
  const limit = Date.now() + MIN_NOTICE * 60000;

  for (const st of staff) {
    const h = effHours(st.id, dow(day));
    if (!h) continue;
    const blocks = (h.bs ? [[h.open, h.bs], [h.be, h.close]] : [[h.open, h.close]]).map(([a, b]) => [zoned(day, a), zoned(day, b)]);
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

/** Compara una visita combinada (varios servicios) con el modelo: suma de duraciones, limpieza del último, paso más fino. */
async function compareCombo(day, label, list) {
  const pseudo = {
    duration_min: list.reduce((a, x) => a + x.duration_min, 0),
    buffer_min: list[list.length - 1].buffer_min,
    step_min: Math.max(5, Math.min(...list.map((x) => x.step_min))),
  };
  const ids = list.map((x) => x.id).join(",");
  const api = new Set(((await api2(`/api/availability?serviceIds=${ids}&from=${day}&to=${day}`)).json?.slots ?? []).filter((x) => x.available).map((x) => x.time));
  const ref = await referenceTimes(pseudo, day);
  const edge = (t) => Math.abs(zoned(day, t) - (Date.now() + MIN_NOTICE * 60000)) < 120000;
  const onlyApi = [...api].filter((t) => !ref.has(t) && !edge(t));
  const onlyRef = [...ref].filter((t) => !api.has(t) && !edge(t));
  check(onlyApi.length === 0 && onlyRef.length === 0, `${label}: visita de ${list.map((x) => x.name).join(" + ")} (${pseudo.duration_min} min) coincide con el modelo`, `solo web [${onlyApi.join(" ")}] · solo modelo [${onlyRef.join(" ")}]`);
}
const api2 = (path) => api(path);

const from = todayStr();
const slotsFor = async (serviceId, day, to = day) =>
  (await api(`/api/availability?serviceId=${serviceId}&from=${day}&to=${to}`)).json?.slots ?? [];

try {
  /* 1 ---------------------------------------------------------------- */
  section("1. Los huecos de cada servicio coinciden con el modelo de referencia (próximos 7 días)");
  for (let i = 0; i < 7; i++) await compareDay(addDays(from, i), addDays(from, i));
  if (services.length >= 3) {
    const combos = [services.slice(0, 2), services.slice(0, 3), [services[2], services[0]]];
    for (const c of combos) for (let i = 1; i < 6; i++) await compareCombo(addDays(from, i), addDays(from, i), c);
  }

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
        overlapBad += list.filter((x) => x.available && overlaps(x.startsAt, s.duration_min + s.buffer_min, bk.startsAt, A.duration_min + A.buffer_min)).length;
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

      // ficha de clienta creada
      const cu = (await db.query(`SELECT count(*)::int AS n FROM customers WHERE phone_key = '600000000'`)).rows[0];
      check(cu.n === 1, "se crea la ficha de la clienta (una sola por teléfono)");

      // cambiar la hora a otro hueco libre
      const other = free.find((x) => x.startsAt !== slot.startsAt && x.day !== slot.day) ?? free.find((x) => x.startsAt !== slot.startsAt);
      if (other) {
        const rs = await api(`/api/bookings/${bk.code}/reschedule`, { method: "POST", body: { token: bk.token, startsAt: other.startsAt } });
        check(rs.status === 200 && rs.json?.booking?.startsAt === other.startsAt, "la clienta cambia la hora de su cita", JSON.stringify(rs));
        const old = await slotsFor(A.id, slot.day);
        check(old.find((x) => x.startsAt === slot.startsAt)?.available === true, "al cambiar la hora, el hueco antiguo se libera");
        const nw = await slotsFor(A.id, other.day);
        check(nw.find((x) => x.startsAt === other.startsAt)?.available === false, "y el nuevo queda ocupado");
        const rrow = (await db.query(`SELECT reschedule_count, reminder_sent_at FROM bookings WHERE code = $1`, [bk.code])).rows[0];
        check(rrow.reschedule_count === 1 && rrow.reminder_sent_at === null, "se anota el cambio y se reinicia el recordatorio");
        // volver a la hora original para seguir con las pruebas
        const back = await api(`/api/bookings/${bk.code}/reschedule`, { method: "POST", body: { token: bk.token, startsAt: slot.startsAt } });
        check(back.status === 200, "se puede volver a la hora original", JSON.stringify(back));
        await compareDay(other.day, "tras el cambio de hora");
      }

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

    /* 3b ------------------------------------------------------------- */
    section("3b. Varios servicios en una visita (suma de duraciones y limpieza al final)");
    const B = services.find((x) => x.id !== A.id);
    if (B) {
      const comboDur = A.duration_min + B.duration_min;
      const comboFree = (
        await api(`/api/availability?serviceIds=${A.id},${B.id}&from=${addDays(from, 3)}&to=${addDays(from, 16)}`)
      ).json?.slots?.filter((x) => x.available);
      if (!comboFree?.length) check(false, "hay huecos para la visita combinada");
      else {
        const cs = comboFree[0];
        const ch = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [A.id, B.id], staffId: null, startsAt: cs.startsAt } });
        check(ch.status === 200 && ch.json?.durationMin === comboDur, `se bloquea la visita combinada (${comboDur} min)`, JSON.stringify(ch));
        const cc = await api("/api/bookings", { method: "POST", body: { holdId: ch.json?.holdId, holdToken: ch.json?.holdToken, name: "E2E Test", phone: "600000002" } });
        const cb = cc.json?.booking;
        check(cc.status === 200 && cb, "se confirma la visita combinada", JSON.stringify(cc));
        if (cb) {
          check((new Date(cb.endsAt) - new Date(cb.startsAt)) / 60000 === comboDur, "dura la suma de los dos servicios");
          const parts = (await db.query(`SELECT count(*)::int AS n FROM booking_services WHERE booking_id = $1`, [cb.id])).rows[0];
          check(parts.n === 2, "se guardan los dos servicios con su precio y duración");
          const bu = (await db.query(`SELECT (blocked_until - ends_at) AS buf FROM bookings WHERE id = $1`, [cb.id])).rows[0];
          check(bu.buf !== null, "se registra el tiempo de limpieza bloqueado");
          await api("/api/respond", { method: "POST", body: { code: cb.code, token: cb.token, action: "cancel" } });
        }
      }
    }

    /* 3c ------------------------------------------------------------- */
    section("3c. Varias citas de la misma clienta y «Tus citas» (las canceladas se muestran con su estado)");
    const pair = [free[2], free.find((x, i) => i > 3 && x.day !== free[2]?.day) ?? free[4]].filter(Boolean);
    if (pair.length < 2) check(false, "hay dos huecos distintos para probar varias citas");
    else {
      const made = [];
      for (const sl of pair) {
        const hh = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [A.id], staffId: null, startsAt: sl.startsAt } });
        const cf = await api("/api/bookings", { method: "POST", body: { holdId: hh.json?.holdId, holdToken: hh.json?.holdToken, name: "E2E Test", phone: "600000003" } });
        if (cf.json?.booking) made.push(cf.json.booking);
      }
      check(made.length === 2, "la misma clienta puede tener dos citas a la vez", `${made.length} creadas`);
      if (made.length === 2) {
        const refs = [{ code: made[0].code, token: made[0].token }];
        const mine1 = await api("/api/my-bookings", { method: "POST", body: { items: refs } });
        const codes1 = (mine1.json?.bookings ?? []).map((b) => b.code);
        check(codes1.includes(made[0].code) && codes1.includes(made[1].code), "«Tus citas» devuelve las dos citas con solo uno de los enlaces", JSON.stringify(codes1));
        const one = (await db.query(`SELECT count(*)::int AS n FROM customers WHERE phone_key = '600000003'`)).rows[0];
        check(one.n === 1, "las dos citas cuelgan de una única ficha de clienta");

        await api("/api/respond", { method: "POST", body: { code: made[1].code, token: made[1].token, action: "cancel" } });
        const mine2 = await api("/api/my-bookings", { method: "POST", body: { items: refs } });
        const byCode = new Map((mine2.json?.bookings ?? []).map((b) => [b.code, b]));
        check(byCode.get(made[1].code)?.status === "CANCELLED", "la cita cancelada sigue apareciendo, marcada como CANCELLED (no desaparece)");
        check(byCode.get(made[0].code)?.status === "CONFIRMED", "la otra cita sigue confirmada");
        const freed = await slotsFor(A.id, pair[1].day);
        check(freed.find((x) => x.startsAt === pair[1].startsAt)?.available === true, "y el hueco de la cancelada vuelve a estar libre");
        await api("/api/respond", { method: "POST", body: { code: made[0].code, token: made[0].token, action: "cancel" } });
      }
    }

    /* 3d ------------------------------------------------------------- */
    section("3d. Visita con varios servicios: tu propio bloqueo no te cierra huecos y el cambio de hueco es atómico");
    const Bsvc = services.find((x) => x.id !== A.id);
    if (Bsvc) {
      const ids = [A.id, Bsvc.id];
      const D = A.duration_min + Bsvc.duration_min;
      const L0 = (await api(`/api/availability?serviceIds=${ids.join(",")}&from=${addDays(from, 3)}&to=${addDays(from, 12)}`)).json?.slots ?? [];
      const avail0 = L0.filter((x) => x.available);
      // dos huecos disponibles que se solapan entre sí (x empieza antes y termina después de que empiece s)
      let pairXS = null;
      for (const x of avail0) for (const sl of avail0) {
        if (x.day === sl.day && x.startsAt < sl.startsAt && new Date(x.startsAt).getTime() + D * 60000 > new Date(sl.startsAt).getTime()) { pairXS = [x, sl]; break; }
        if (pairXS) break;
      }
      if (!pairXS) check(false, "hay dos huecos solapados para probar el bloqueo propio");
      else {
        const [x, sl] = pairXS;
        const h = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: ids, staffId: null, startsAt: sl.startsAt } });
        check(h.status === 200 && h.json?.durationMin === D && h.json?.blockedMin >= D, "se bloquea la visita combinada y el servidor informa de cuánto ocupa", JSON.stringify(h));
        const without = (await api(`/api/availability?serviceIds=${ids.join(",")}&from=${x.day}&to=${x.day}`)).json?.slots ?? [];
        check(without.find((y) => y.startsAt === x.startsAt)?.available === false, "para las demás, el hueco que se solapa con tu bloqueo aparece ocupado");
        const withOwn = (await api(`/api/availability?serviceIds=${ids.join(",")}&from=${x.day}&to=${x.day}&holdId=${h.json?.holdId}&holdToken=${h.json?.holdToken}`)).json?.slots ?? [];
        check(withOwn.find((y) => y.startsAt === x.startsAt)?.available === true, "para ti, ese mismo hueco sigue disponible (tu propio bloqueo no te lo cierra)");

        // cambiar al hueco x: se libera el anterior en la misma operación
        const sw = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: ids, staffId: null, startsAt: x.startsAt, replaceHoldId: h.json?.holdId, replaceToken: h.json?.holdToken } });
        check(sw.status === 200 && sw.json?.holdId !== h.json?.holdId, "se puede mover el bloqueo a una hora que se solapa con la anterior", JSON.stringify(sw));
        const old = (await db.query(`SELECT status FROM bookings WHERE id = $1`, [h.json?.holdId])).rows[0];
        check(old?.status === "EXPIRED", "el bloqueo anterior queda liberado");

        // cambio que falla: el hueco nuevo ya está ocupado → el bloqueo actual NO se pierde
        const other = avail0.find((y) => y.day !== x.day && y.startsAt !== x.startsAt) ?? avail0[avail0.length - 1];
        const hz = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: ids, staffId: null, startsAt: other.startsAt } });
        const cz = await api("/api/bookings", { method: "POST", body: { holdId: hz.json?.holdId, holdToken: hz.json?.holdToken, name: "E2E Test", phone: "600000004" } });
        const fail = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: ids, staffId: null, startsAt: other.startsAt, replaceHoldId: sw.json?.holdId, replaceToken: sw.json?.holdToken } });
        check(fail.status === 409, "mover el bloqueo a un hueco ocupado da error", JSON.stringify(fail));
        const kept = (await db.query(`SELECT status FROM bookings WHERE id = $1`, [sw.json?.holdId])).rows[0];
        check(kept?.status === "HOLD", "…y el bloqueo que ya tenías sigue guardado (no te quedas sin hueco)");
        await api(`/api/holds/${sw.json?.holdId}?token=${sw.json?.holdToken}`, { method: "DELETE" });
        if (cz.json?.booking) await api("/api/respond", { method: "POST", body: { code: cz.json.booking.code, token: cz.json.booking.token, action: "cancel" } });
      }

      // invariante: TODO hueco que se ofrece como disponible se puede reservar (probamos una muestra repartida)
      const sample = avail0.filter((_, i) => i % Math.max(1, Math.floor(avail0.length / 14)) === 0).slice(0, 14);
      let notBookable = 0;
      for (const sl of sample) {
        const r = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: ids, staffId: null, startsAt: sl.startsAt } });
        if (r.status !== 200) notBookable++;
        else await api(`/api/holds/${r.json.holdId}?token=${r.json.holdToken}`, { method: "DELETE" });
      }
      check(notBookable === 0, `todo hueco ofrecido se puede reservar (${sample.length} comprobados en visitas de ${D} min)`, `${notBookable} fallaron`);

      // lista de espera con varios servicios
      const wl = await api("/api/waitlist", { method: "POST", ip: freshIp(), body: { serviceIds: ids, day: addDays(from, 5), name: "E2E Test", phone: "600000005" } });
      const wrow = (await db.query(`SELECT service_ids FROM waitlist WHERE phone_key = '600000005'`)).rows[0];
      check(wl.status === 200 && Array.isArray(wrow?.service_ids) && wrow.service_ids.length === 2, "la lista de espera guarda la visita completa (varios servicios)");
    }

    /* 3e ------------------------------------------------------------- */
    section("3e. Visita en horas distintas: una cita por servicio, confirmadas de una vez (o ninguna)");
    {
      const Bs = services.find((x) => x.id !== A.id);
      const slotsA = (await slotsFor(A.id, addDays(from, 3), addDays(from, 12))).filter((x) => x.available);
      const slotsB = (await slotsFor(Bs.id, addDays(from, 3), addDays(from, 12))).filter((x) => x.available);
      const l1 = slotsA[0];
      const l2 = slotsB.find((x) => x.day !== l1?.day);
      if (!l1 || !l2) check(false, "hay huecos en dos días distintos para probar la visita en horas distintas");
      else {
        const ip = freshIp();
        const h1 = await api("/api/holds", { method: "POST", ip, body: { serviceIds: [A.id], staffId: null, startsAt: l1.startsAt } });
        const h2 = await api("/api/holds", { method: "POST", ip, body: { serviceIds: [Bs.id], staffId: null, startsAt: l2.startsAt, extend: [{ holdId: h1.json?.holdId, holdToken: h1.json?.holdToken }] } });
        check(h1.status === 200 && h2.status === 200 && h2.json?.extendedIds?.includes(h1.json?.holdId), "se bloquea la segunda hora y el servidor alarga el bloqueo de la primera", JSON.stringify(h2));
        const exp = (await db.query(`SELECT max(hold_expires_at) - min(hold_expires_at) AS gap FROM bookings WHERE id = ANY($1::uuid[])`, [[h1.json?.holdId, h2.json?.holdId]])).rows[0];
        check(Number(exp.gap?.seconds ?? 0) < 3 && !exp.gap?.minutes, "los dos bloqueos caducan a la vez", JSON.stringify(exp.gap));

        const legs = [h1, h2].map((h) => ({ holdId: h.json?.holdId, holdToken: h.json?.holdToken }));
        const cf = await api("/api/bookings/batch", { method: "POST", body: { legs, name: "E2E Test", phone: "600000006" } });
        const codes = (cf.json?.bookings ?? []).map((b) => b.code);
        check(cf.status === 200 && codes.length === 2 && new Set(codes).size === 2, "se confirman las dos citas de una vez, cada una con su código", JSON.stringify(cf.json?.error ?? codes));
        const grp = (await db.query(`SELECT count(*)::int AS n, count(DISTINCT group_id)::int AS g, bool_and(status = 'CONFIRMED') AS ok FROM bookings WHERE id = ANY($1::uuid[])`, [legs.map((l) => l.holdId)])).rows[0];
        check(grp.n === 2 && grp.g === 1 && grp.ok === true, "las dos citas quedan confirmadas y unidas en un mismo grupo");
        const cust = (await db.query(`SELECT count(*)::int AS n FROM customers WHERE phone_key = '600000006'`)).rows[0];
        check(cust.n === 1, "y cuelgan de una única ficha de clienta");
        const again = await api("/api/bookings/batch", { method: "POST", body: { legs, name: "E2E Test", phone: "600000006" } });
        check(again.status === 200 && (again.json?.bookings ?? []).map((b) => b.code).join() === codes.join(), "repetir la confirmación (doble clic) devuelve las mismas citas sin duplicar");

        // cada cita se puede cancelar por separado; la otra sigue
        const c1 = cf.json.bookings[0];
        await api("/api/respond", { method: "POST", body: { code: c1.code, token: c1.token, action: "cancel" } });
        const st = (await db.query(`SELECT status FROM bookings WHERE group_id = (SELECT group_id FROM bookings WHERE id = $1) ORDER BY starts_at`, [c1.id])).rows.map((r) => r.status);
        check(st.join() === "CANCELLED,CONFIRMED", "cancelar una cita del grupo no cancela la otra", st.join());
        await api("/api/respond", { method: "POST", body: { code: cf.json.bookings[1].code, token: cf.json.bookings[1].token, action: "cancel" } });
      }

      // el tope de bloqueos por IP no se come las citas hermanas (visita de 4 servicios en horas distintas)
      const four = services.slice(0, 4);
      const ipFix = freshIp();
      const made = [];
      for (let i = 0; i < four.length; i++) {
        const sl = (await slotsFor(four[i].id, addDays(from, 4 + i), addDays(from, 4 + i))).find((x) => x.available);
        if (!sl) continue;
        const r = await api("/api/holds", { method: "POST", ip: ipFix, body: { serviceIds: [four[i].id], staffId: null, startsAt: sl.startsAt, extend: made.map((m) => ({ holdId: m.holdId, holdToken: m.holdToken })) } });
        if (r.status === 200) made.push(r.json);
      }
      const alive = (await db.query(`SELECT count(*)::int AS n FROM bookings WHERE id = ANY($1::uuid[]) AND status = 'HOLD'`, [made.map((m) => m.holdId)])).rows[0].n;
      check(made.length >= 3 && alive === made.length, `${made.length} bloqueos hermanos desde la misma IP siguen vivos (el tope por IP no los libera)`, `${alive}/${made.length}`);
      for (const m of made) await api(`/api/holds/${m.holdId}?token=${m.holdToken}`, { method: "DELETE" });

      // una clienta no puede tener dos citas solapadas (aunque sean con profesionales distintas)
      const extra = (await db.query(`INSERT INTO staff (name, sort, active) VALUES ('E2E Staff', 99, true) RETURNING id`)).rows[0].id;
      try {
        const base = slotsA.find((x) => x.day !== l1?.day) ?? slotsA[1];
        const p1 = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [A.id], staffId: null, startsAt: base.startsAt } });
        const c1 = await api("/api/bookings", { method: "POST", body: { holdId: p1.json?.holdId, holdToken: p1.json?.holdToken, name: "E2E Test", phone: "600000007" } });
        const sameTime = (await slotsFor(A.id, base.day)).find((x) => x.startsAt === base.startsAt);
        const withOther = (await api(`/api/availability?serviceIds=${A.id}&from=${base.day}&to=${base.day}&staffId=${extra}`)).json?.slots?.find((x) => x.startsAt === base.startsAt);
        if (c1.status === 200 && withOther?.available) {
          const p2 = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [A.id], staffId: extra, startsAt: base.startsAt } });
          const c2 = await api("/api/bookings", { method: "POST", body: { holdId: p2.json?.holdId, holdToken: p2.json?.holdToken, name: "E2E Test", phone: "600000007" } });
          check(c2.status === 409 && c2.json?.error?.code === "CONFLICT", "la misma clienta no puede reservar a la misma hora con otra profesional", JSON.stringify(c2.json?.error ?? c2.status));
          check(sameTime !== undefined, "(referencia) el hueco original existe");
        } else check(false, "preparación de la prueba de citas solapadas", `c1=${c1.status} otra=${withOther?.available}`);
        if (c1.json?.booking) await api("/api/respond", { method: "POST", body: { code: c1.json.booking.code, token: c1.json.booking.token, action: "cancel" } });
      } finally {
        await db.query(`DELETE FROM bookings WHERE staff_id = $1`, [extra]);
        await db.query(`DELETE FROM staff WHERE id = $1`, [extra]);
      }
    }

    /* 3f ------------------------------------------------------------- */
    section("3f. Reserva completa: extras, pack con descuento, servicio repetido, casillas de seguridad y tope de citas");
    {
      const all = (await db.query(`SELECT id, slug, name, category, duration_min, price_cents FROM services WHERE active ORDER BY sort, id`)).rows;
      const bySlug = Object.fromEntries(all.map((r) => [r.slug, r]));
      const firstFree = async (ids, fromOffset = 3) => {
        const sl = (await api(`/api/availability?serviceIds=${ids.join(",")}&from=${addDays(from, fromOffset)}&to=${addDays(from, fromOffset + 12)}`)).json?.slots ?? [];
        return sl.find((x) => x.available);
      };
      const release = (r) => api(`/api/holds/${r.json?.holdId}?token=${r.json?.holdToken}`, { method: "DELETE" });

      // 1) extras: suman duración y precio, se guardan como fila de la cita y se pueden pedir como disponibilidad
      const addon = (await db.query(`SELECT id, duration_min, price_cents, category FROM addons WHERE active ORDER BY sort, id LIMIT 1`)).rows[0];
      if (!addon) check(false, "hay al menos un extra activo para probar");
      else {
        const base = (await db.query(`SELECT id, duration_min, price_cents FROM services WHERE active AND ($1::text IS NULL OR category = $1) ORDER BY duration_min LIMIT 1`, [addon.category])).rows[0];
        const sl = await firstFree([base.id]);
        const h = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [base.id], addonIds: [addon.id], staffId: null, startsAt: sl.startsAt } });
        check(h.status === 200 && h.json?.durationMin === base.duration_min + addon.duration_min && h.json?.priceCents === base.price_cents + addon.price_cents, "el extra suma su duración y su precio al bloqueo", JSON.stringify(h.json));
        const rows = (await db.query(`SELECT is_addon, service_id FROM booking_services WHERE booking_id = $1 ORDER BY position`, [h.json?.holdId])).rows;
        check(rows.length === 2 && rows[1].is_addon === true && rows[1].service_id === null, "el extra queda guardado como una fila de la cita (sin servicio asociado)");
        const n0 = ((await api(`/api/availability?serviceIds=${base.id}&from=${addDays(from, 3)}&to=${addDays(from, 9)}`)).json?.slots ?? []).filter((x) => x.available).length;
        const n1 = ((await api(`/api/availability?serviceIds=${base.id}&addonIds=${addon.id}&from=${addDays(from, 3)}&to=${addDays(from, 9)}`)).json?.slots ?? []).filter((x) => x.available).length;
        check(n1 <= n0, "con el extra (más tiempo) no salen más huecos que sin él", `${n1} ≤ ${n0}`);
        await release(h);
        const other = (await db.query(`SELECT a.id AS aid, s.id AS sid FROM addons a, services s WHERE a.category IS NOT NULL AND s.active AND s.category <> a.category AND a.active LIMIT 1`)).rows[0];
        if (other) {
          const bad = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [other.sid], addonIds: [other.aid], staffId: null, startsAt: sl.startsAt } });
          check(bad.status === 400, "un extra no se puede añadir a un servicio de otra categoría", String(bad.status));
        }
      }

      // 2) el mismo servicio dos veces (manicura para ti y para tu acompañante)
      const A2 = all[0];
      const sl2 = await firstFree([A2.id, A2.id]);
      if (sl2) {
        const h2 = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [A2.id, A2.id], staffId: null, startsAt: sl2.startsAt } });
        check(h2.status === 200 && h2.json?.durationMin === 2 * A2.duration_min, "el mismo servicio puede ir dos veces en una visita (acompañante)", JSON.stringify(h2.json));
        await release(h2);
      }

      // 3) pack: el descuento solo se aplica si los servicios son exactamente los del pack
      const pack = (await db.query(`SELECT slug, service_slugs, discount_percent FROM packages WHERE active ORDER BY sort LIMIT 1`)).rows[0];
      if (pack && pack.service_slugs.every((x) => bySlug[x])) {
        await db.query(`UPDATE packages SET discount_percent = 20 WHERE slug = $1`, [pack.slug]);
        try {
          const ids = pack.service_slugs.map((x) => bySlug[x].id);
          const full = pack.service_slugs.reduce((a, x) => a + bySlug[x].price_cents, 0);
          const disc = pack.service_slugs.reduce((a, x) => a + Math.round(bySlug[x].price_cents * 0.8), 0);
          const slp = await firstFree(ids);
          if (slp) {
            const withPack = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: ids, packageSlug: pack.slug, staffId: null, startsAt: slp.startsAt } });
            check(withPack.status === 200 && withPack.json?.priceCents === disc, "con el pack se aplica el 20 % a los servicios", `${withPack.json?.priceCents} vs ${disc}`);
            const rowsP = (await db.query(`SELECT p.package_slug, (SELECT SUM(price_cents)::int FROM booking_services WHERE booking_id = p.id) AS total FROM bookings p WHERE id = $1`, [withPack.json?.holdId])).rows[0];
            check(rowsP?.package_slug === pack.slug && rowsP?.total === disc, "el precio con descuento queda guardado en la cita", JSON.stringify(rowsP));
            await release(withPack);
            const noPack = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: ids, staffId: null, startsAt: slp.startsAt } });
            check(noPack.status === 200 && noPack.json?.priceCents === full, "sin pedir el pack no hay descuento", `${noPack.json?.priceCents} vs ${full}`);
            await release(noPack);
            const extraSvc = all.find((x) => !ids.includes(x.id));
            const slx = await firstFree([...ids, extraSvc.id]);
            if (slx) {
              const broken = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [...ids, extraSvc.id], packageSlug: pack.slug, staffId: null, startsAt: slx.startsAt } });
              check(broken.status === 200 && broken.json?.priceCents === full + extraSvc.price_cents, "si los servicios ya no son exactamente los del pack, no hay descuento", `${broken.json?.priceCents}`);
              await release(broken);
            }
          }
        } finally {
          await db.query(`UPDATE packages SET discount_percent = $2 WHERE slug = $1`, [pack.slug, pack.discount_percent]);
        }
      } else check(true, "(sin packs activos con servicios existentes: se omite la prueba del descuento)");

      // 4) casillas de seguridad: sin marcarlas no se confirma; marcadas, solo se guarda que las marcó
      const mb = (await db.query(`SELECT id, slug FROM services WHERE active AND consent_kind IS NOT NULL ORDER BY id LIMIT 1`)).rows[0];
      if (mb) {
        const kind = (await db.query(`SELECT consent_kind FROM services WHERE id = $1`, [mb.id])).rows[0].consent_kind;
        const slm = await firstFree([mb.id], 5);
        if (slm) {
          const hm = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [mb.id], staffId: null, startsAt: slm.startsAt } });
          const noAck = await api("/api/bookings", { method: "POST", body: { holdId: hm.json?.holdId, holdToken: hm.json?.holdToken, name: "E2E Test", phone: "600000008" } });
          check(noAck.status === 400, "sin marcar las casillas de seguridad no se confirma el tratamiento", String(noAck.status));
          const ack = await api("/api/bookings", { method: "POST", body: { holdId: hm.json?.holdId, holdToken: hm.json?.holdToken, name: "E2E Test", phone: "600000008", acks: [kind] } });
          const saved = (await db.query(`SELECT consent_acks, consent_at FROM bookings WHERE id = $1`, [hm.json?.holdId])).rows[0];
          check((ack.status === 200 || ack.json?.checkoutUrl) && saved?.consent_acks?.[0] === kind && !!saved?.consent_at, "marcadas las casillas, se guarda solo que las marcó (y cuándo)", JSON.stringify(saved));
          if (ack.json?.booking) await api("/api/respond", { method: "POST", body: { code: ack.json.booking.code, token: ack.json.booking.token, action: "cancel" } });
        }
      }

      // 5) tope de citas futuras por teléfono
      const MAXA = Number(process.env.MAX_ACTIVE_BOOKINGS ?? 6);
      const staff1 = (await db.query(`SELECT id FROM staff WHERE active ORDER BY sort, id LIMIT 1`)).rows[0].id;
      for (let i = 0; i < MAXA; i++) {
        await db.query(
          `INSERT INTO bookings (code, staff_id, service_id, starts_at, ends_at, status, hold_token, customer_name, customer_phone, confirmed_at)
           VALUES ($1, $2, $3, now() + make_interval(days => $4::int), now() + make_interval(days => $4::int, mins => 30), 'CONFIRMED', 'e2e', 'E2E Test', '600000009', now())`,
          [`E2EL${i}${Date.now() % 100000}`, staff1, A2.id, 40 + i],
        );
      }
      const slL = await firstFree([A2.id], 3);
      if (slL) {
        const hl = await api("/api/holds", { method: "POST", ip: freshIp(), body: { serviceIds: [A2.id], staffId: null, startsAt: slL.startsAt } });
        const cl = await api("/api/bookings", { method: "POST", body: { holdId: hl.json?.holdId, holdToken: hl.json?.holdToken, name: "E2E Test", phone: "600000009" } });
        check(cl.status === 429 && cl.json?.error?.code === "LIMIT", `con ${MAXA} citas pendientes no se puede reservar otra (llamar al salón)`, JSON.stringify(cl.json?.error ?? cl.status));
        await release(hl);
      }
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
  await db.query(`DELETE FROM customers WHERE phone_key IN ('600000000','600000001','600000002','600000003','600000004','600000005','600000006','600000007','600000008','600000009')`);
  await db.end();
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} correctas, ${fail} con fallos`);
process.exit(fail === 0 ? 0 : 1);
