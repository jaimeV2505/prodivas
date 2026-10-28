"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { isAdmin, revokeAllSessions } from "@/lib/auth";
import { query } from "@/lib/db";
import { CONSENT_KINDS } from "@/lib/consent";
import { formatPhases, parsePhases, type Phase } from "@/lib/blocks";
import { isDay } from "@/lib/dates";
import { enabled, sendEmail, sendSms, sendTelegram, sendWhatsAppTemplate, type SendResult } from "@/lib/messaging";

async function guard(action?: string) {
  if (!(await isAdmin())) redirect("/admin");
  if (action && !READ_ONLY.has(action)) await audit(action);
}
const READ_ONLY = new Set<string>([]);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (msg: string) => redirect(`/admin/ajustes?ok=${encodeURIComponent(msg)}`);
const fail = (msg: string) => redirect(`/admin/ajustes?err=${encodeURIComponent(msg)}`);

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "servicio";

const euros = (s: string) => {
  const n = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};

const ServiceSchema = z.object({
  name: z.string().min(2, "El nombre es muy corto").max(80),
  category: z.string().min(2, "Pon una categoría").max(60),
  duration: z.coerce.number().int().min(5, "La duración mínima es 5 min").max(480).refine((n) => n % 5 === 0, "La duración debe ser múltiplo de 5"),
  price: z.number().int().min(0),
  step: z.number().int().min(5).max(480).nullable(),
  buffer: z.coerce.number().int().min(0).max(120).refine((n) => n % 5 === 0, "La limpieza debe ser múltiplo de 5"),
  deposit: z.number().int().min(0),
  sort: z.coerce.number().int().min(0).max(9999),
  rebook: z.number().int().min(1, "El retoque es de 1 a 26 semanas").max(26, "El retoque es de 1 a 26 semanas").nullable(),
  consent: z.enum(CONSENT_KINDS).nullable(),
  notice: z.number().int().min(0, "El plazo va de 0 a 168 horas").max(168, "El plazo va de 0 a 168 horas").nullable(),
  aftercare: z.string().max(500, "Los cuidados caben en 500 caracteres"),
});

function parseService(fd: FormData) {
  const price = euros(str(fd, "price"));
  const stepRaw = str(fd, "step");
  const r = ServiceSchema.safeParse({
    name: str(fd, "name"),
    category: str(fd, "category"),
    duration: str(fd, "duration"),
    price: Number.isNaN(price) ? -1 : price,
    step: stepRaw === "" ? null : Number(stepRaw),
    buffer: str(fd, "buffer") || "0",
    deposit: Number.isNaN(euros(str(fd, "deposit") || "0")) ? -1 : euros(str(fd, "deposit") || "0"),
    sort: str(fd, "sort") || "0",
    rebook: str(fd, "rebook") === "" ? null : Number(str(fd, "rebook")),
    consent: str(fd, "consent") === "" ? null : str(fd, "consent"),
    notice: str(fd, "notice") === "" ? null : Number(str(fd, "notice")),
    aftercare: str(fd, "aftercare"),
  });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa los datos del servicio");
  return r.data!;
}

/** Fases de pose y recurso de un servicio, tal como las escribe la dueña. Valida que las fases sumen la duración. */
function parsePose(fd: FormData, duration: number): { phases: Phase[]; resKind: string | null; resUses: "all" | "active" } {
  const raw = str(fd, "phases");
  let phases: Phase[] = [];
  if (raw) {
    const p = parsePhases(raw);
    if (!p || !p.length) fail("Las fases se escriben así: «30 + 45e + 30» (los minutos; la «e» marca los de espera)");
    const sum = p!.reduce((a, x) => a + x.minutes, 0);
    if (sum !== duration) fail(`Las fases suman ${sum} min y el servicio dura ${duration} min: tienen que coincidir`);
    if (!p!.some((x) => x.kind === "active")) fail("Tiene que haber al menos una fase en la que la profesional actúe");
    // una sola fase de actuar = servicio normal: no se guarda
    phases = p!.some((x) => x.kind === "wait") ? p! : [];
  }
  const k = z.string().trim().toLowerCase().max(40, "El tipo de recurso es muy largo").safeParse(str(fd, "res_kind"));
  if (!k.success) fail(k.error.issues[0]?.message ?? "Revisa el recurso");
  const uses = z.enum(["all", "active"]).safeParse(str(fd, "res_uses") || "all");
  return { phases, resKind: k.data! || null, resUses: uses.success ? uses.data : "all" };
}

async function savePose(serviceId: number, pose: ReturnType<typeof parsePose>) {
  await query(`DELETE FROM service_phases WHERE service_id = $1::int`, [serviceId]);
  for (let i = 0; i < pose.phases.length; i++) {
    await query(`INSERT INTO service_phases (service_id, position, kind, minutes) VALUES ($1::int, $2::int, $3, $4::int)`, [serviceId, i, pose.phases[i].kind, pose.phases[i].minutes]);
  }
  await query(`DELETE FROM service_resources WHERE service_id = $1::int`, [serviceId]);
  if (pose.resKind) await query(`INSERT INTO service_resources (service_id, kind, uses) VALUES ($1::int, $2, $3)`, [serviceId, pose.resKind, pose.resUses]);
}

export async function saveModeAction(fd: FormData) {
  await guard("saveModeAction");
  const mode = z.enum(["smart", "compact", "flex"]).safeParse(str(fd, "mode"));
  if (!mode.success) fail("Modo no válido");
  await query(`INSERT INTO settings (key, value) VALUES ('slot_mode', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [mode.data!]);
  revalidatePath("/admin/ajustes");
  done("Modo de huecos guardado");
}

export async function saveServiceAction(fd: FormData) {
  await guard("saveServiceAction");
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  const s = parseService(fd);
  const pose = parsePose(fd, s.duration);
  await query(
    `UPDATE services SET name = $2, category = $3, duration_min = $4, price_cents = $5, slot_step_min = $6, sort = $7, active = $8,
                         buffer_min = $9, deposit_cents = LEAST($10::int, $5::int),
                         rebook_weeks = $11::int, consent_kind = $12, deposit_always = $13, cancel_notice_hours = $14::int, aftercare = NULLIF($15, '') WHERE id = $1::int`,
    [id, s.name, s.category, s.duration, s.price, s.step, s.sort, fd.get("active") === "on", s.buffer, s.deposit, s.rebook, s.consent, fd.get("deposit_always") === "on", s.notice, s.aftercare],
  );
  await savePose(id, pose);
  revalidatePath("/admin/ajustes");
  done(`Guardado: ${s.name}`);
}

export async function addServiceAction(fd: FormData) {
  await guard("addServiceAction");
  const s = parseService(fd);
  const pose = parsePose(fd, s.duration);
  const base = slugify(s.name);
  const taken = new Set((await query<{ slug: string }>(`SELECT slug FROM services WHERE slug LIKE $1`, [`${base}%`])).map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  await query(
    `INSERT INTO services (slug, name, category, duration_min, price_cents, slot_step_min, sort, active, buffer_min, deposit_cents, rebook_weeks, consent_kind, deposit_always, cancel_notice_hours)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, LEAST($9::int, $5::int), $10::int, $11, $12, $13::int)`,
    [slug, s.name, s.category, s.duration, s.price, s.step, s.sort, s.buffer, s.deposit, s.rebook, s.consent, fd.get("deposit_always") === "on", s.notice],
  );
  const created = await query<{ id: number }>(`SELECT id FROM services WHERE slug = $1`, [slug]);
  if (created[0]) await savePose(created[0].id, pose);
  revalidatePath("/admin/ajustes");
  done(`Servicio creado: ${s.name}`);
}

const hhmm = /^\d{2}:\d{2}$/;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export async function saveHoursAction(fd: FormData) {
  await guard("saveHoursAction");
  const weekday = z.coerce.number().int().min(0).max(6).parse(str(fd, "weekday"));
  if (fd.get("closed") === "on") {
    await query(
      `INSERT INTO business_hours (weekday, closed, open_time, close_time, break_start, break_end)
       VALUES ($1::int, true, NULL, NULL, NULL, NULL)
       ON CONFLICT (weekday) DO UPDATE SET closed = true, open_time = NULL, close_time = NULL, break_start = NULL, break_end = NULL`,
      [weekday],
    );
    revalidatePath("/admin/ajustes");
    done("Día marcado como cerrado");
  }
  const open = str(fd, "open");
  const close = str(fd, "close");
  const bs = str(fd, "bs");
  const be = str(fd, "be");
  if (!hhmm.test(open) || !hhmm.test(close) || mins(open) >= mins(close)) fail("Revisa la hora de apertura y cierre");
  if ((bs && !be) || (!bs && be)) fail("La pausa necesita hora de inicio y de fin (o déjala vacía)");
  if (bs && be && !(hhmm.test(bs) && hhmm.test(be) && mins(open) <= mins(bs) && mins(bs) < mins(be) && mins(be) <= mins(close))) {
    fail("La pausa debe estar dentro del horario y terminar después de empezar");
  }
  await query(
    `INSERT INTO business_hours (weekday, closed, open_time, close_time, break_start, break_end)
     VALUES ($1::int, false, $2::time, $3::time, $4::time, $5::time)
     ON CONFLICT (weekday) DO UPDATE SET closed = false, open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time,
                                         break_start = EXCLUDED.break_start, break_end = EXCLUDED.break_end`,
    [weekday, open, close, bs || null, be || null],
  );
  revalidatePath("/admin/ajustes");
  done("Horario guardado");
}


/* ---------- Profesionales y sus horarios ---------- */

export async function addStaffAction(fd: FormData) {
  await guard("addStaffAction");
  const name = z.string().min(2, "Pon un nombre").max(60).safeParse(str(fd, "name"));
  if (!name.success) fail(name.error.issues[0]?.message ?? "Nombre no válido");
  await query(`INSERT INTO staff (name, sort) VALUES ($1, COALESCE((SELECT max(sort) + 1 FROM staff), 1))`, [name.data!]);
  revalidatePath("/admin/ajustes");
  done(`Profesional añadida: ${name.data}`);
}

export async function saveStaffAction(fd: FormData) {
  await guard("saveStaffAction");
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  const name = z.string().min(2).max(60).safeParse(str(fd, "name"));
  if (!name.success) fail("Pon un nombre");
  const active = fd.get("active") === "on";
  if (!active) {
    const others = await query<{ n: number }>(`SELECT count(*)::int AS n FROM staff WHERE active AND id <> $1::int`, [id]);
    if (others[0].n === 0) fail("Tiene que quedar al menos una profesional activa");
  }
  await query(`UPDATE staff SET name = $2, active = $3 WHERE id = $1::int`, [id, name.data!, active]);
  revalidatePath("/admin/ajustes");
  done("Profesional guardada");
}

export async function saveStaffHoursAction(fd: FormData) {
  await guard("saveStaffHoursAction");
  const staffId = z.coerce.number().int().positive().parse(str(fd, "staffId"));
  const weekday = z.coerce.number().int().min(0).max(6).parse(str(fd, "weekday"));
  if (fd.get("closed") === "on") {
    await query(
      `INSERT INTO staff_hours (staff_id, weekday, closed) VALUES ($1::int, $2::int, true)
       ON CONFLICT (staff_id, weekday) DO UPDATE SET closed = true, open_time = NULL, close_time = NULL, break_start = NULL, break_end = NULL`,
      [staffId, weekday],
    );
    revalidatePath("/admin/ajustes");
    done("Ese día no trabaja");
  }
  const open = str(fd, "open");
  const close = str(fd, "close");
  const bs = str(fd, "bs");
  const be = str(fd, "be");
  if (!hhmm.test(open) || !hhmm.test(close) || mins(open) >= mins(close)) fail("Revisa la hora de entrada y salida");
  if ((bs && !be) || (!bs && be)) fail("La pausa necesita inicio y fin (o déjala vacía)");
  if (bs && be && !(hhmm.test(bs) && hhmm.test(be) && mins(open) <= mins(bs) && mins(bs) < mins(be) && mins(be) <= mins(close))) {
    fail("La pausa debe estar dentro de su horario");
  }
  await query(
    `INSERT INTO staff_hours (staff_id, weekday, closed, open_time, close_time, break_start, break_end)
     VALUES ($1::int, $2::int, false, $3::time, $4::time, $5::time, $6::time)
     ON CONFLICT (staff_id, weekday) DO UPDATE SET closed = false, open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time,
                                                   break_start = EXCLUDED.break_start, break_end = EXCLUDED.break_end`,
    [staffId, weekday, open, close, bs || null, be || null],
  );
  revalidatePath("/admin/ajustes");
  done("Horario de la profesional guardado");
}

export async function clearStaffHoursAction(fd: FormData) {
  await guard("clearStaffHoursAction");
  const staffId = z.coerce.number().int().positive().parse(str(fd, "staffId"));
  await query(`DELETE FROM staff_hours WHERE staff_id = $1::int`, [staffId]);
  revalidatePath("/admin/ajustes");
  done("Vuelve a seguir el horario del salón");
}

/* ---------- Probar los canales de aviso ---------- */

export async function testChannelAction(fd: FormData) {
  await guard("testChannelAction");
  const channel = z.enum(["telegram", "email", "sms", "whatsapp"]).parse(str(fd, "channel"));
  const phone = str(fd, "phone");
  const text = "Prueba de Pro Diva: si lees esto, este canal funciona.";
  let r: SendResult;
  if (channel === "telegram") {
    r = enabled.telegram() ? await sendTelegram(`✅ ${text}`) : { ok: false, detail: "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID" };
  } else if (channel === "email") {
    const to = process.env.OWNER_EMAIL;
    r = enabled.email() && to ? await sendEmail([to], "Prueba de Pro Diva", `<p>${text}</p>`) : { ok: false, detail: "Faltan RESEND_API_KEY, MAIL_FROM u OWNER_EMAIL" };
  } else if (!phone || phone.replace(/\D/g, "").length < 9) {
    r = { ok: false, detail: "Escribe un teléfono válido (con prefijo, p. ej. +34600123456)" };
  } else if (channel === "sms") {
    r = enabled.sms() ? await sendSms(phone, text) : { ok: false, detail: "Faltan las variables de Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM)" };
  } else {
    // Plantilla de ejemplo que Meta incluye en las cuentas de prueba
    r = enabled.whatsapp()
      ? await sendWhatsAppTemplate(phone, process.env.WA_TEMPLATE_TEST || "hello_world", [], [], process.env.WA_TEMPLATE_TEST_LANG || "en_US")
      : { ok: false, detail: "Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID" };
  }
  if (r.ok) done(`Prueba enviada por ${channel}. Comprueba que te ha llegado.`);
  fail(`No se pudo enviar por ${channel}: ${r.detail ?? "error desconocido"}`);
}

/* ---------- Tendencias del avatar ---------- */

const TOPICS = ["nails", "lashes", "brows", "wax", "general"] as const;
const TrendSchema = z.object({
  emoji: z.string().min(1, "Pon un emoji").max(8),
  title: z.string().min(2, "El título es muy corto").max(60),
  body: z.string().min(5, "El texto es muy corto").max(280, "El texto es muy largo (máximo 280)"),
  topic: z.enum(TOPICS),
  sort: z.coerce.number().int().min(0).max(9999),
});

async function parseTrend(fd: FormData) {
  const r = TrendSchema.safeParse({
    emoji: str(fd, "emoji"),
    title: str(fd, "title"),
    body: str(fd, "body"),
    topic: str(fd, "topic") || "general",
    sort: str(fd, "sort") || "100",
  });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa la tendencia");
  const slug = str(fd, "service_slug");
  let serviceSlug: string | null = null;
  if (slug) {
    const ok = await query<{ slug: string }>(`SELECT slug FROM services WHERE slug = $1`, [slug]);
    if (!ok[0]) fail("Ese servicio no existe");
    serviceSlug = slug;
  }
  return { ...r.data!, serviceSlug };
}
const afterTrend = (msg: string) => {
  revalidatePath("/admin/ajustes");
  revalidatePath("/reservar");
  done(msg);
};

export async function addTrendAction(fd: FormData) {
  await guard("addTrendAction");
  const t = await parseTrend(fd);
  await query(`INSERT INTO trends (emoji, title, body, topic, service_slug, sort) VALUES ($1, $2, $3, $4, $5, $6::int)`, [t.emoji, t.title, t.body, t.topic, t.serviceSlug, t.sort]);
  afterTrend("Tendencia añadida");
}

export async function saveTrendAction(fd: FormData) {
  await guard("saveTrendAction");
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id)) fail("Tendencia no válida");
  const t = await parseTrend(fd);
  await query(
    `UPDATE trends SET emoji = $2, title = $3, body = $4, topic = $5, service_slug = $6, sort = $7::int, active = $8 WHERE id = $1::int`,
    [id, t.emoji, t.title, t.body, t.topic, t.serviceSlug, t.sort, fd.get("active") === "on"],
  );
  afterTrend("Tendencia guardada");
}

export async function deleteTrendAction(fd: FormData) {
  await guard("deleteTrendAction");
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) await query(`DELETE FROM trends WHERE id = $1::int`, [id]);
  afterTrend("Tendencia borrada");
}

/* ---------- Señal inteligente ---------- */
export async function saveDepositPolicyAction(fd: FormData) {
  await guard("saveDepositPolicyAction");
  const r = z
    .object({
      policy: z.enum(["service", "repeat"]),
      after: z.coerce.number().int().min(1, "Mínimo 1 falta").max(10, "Máximo 10 faltas"),
      cents: z.number().int().min(0).max(100000),
    })
    .safeParse({ policy: str(fd, "policy"), after: str(fd, "after") || "1", cents: euros(str(fd, "amount") || "10") });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa la política de señal");
  const v = r.data!;
  for (const [k, val] of [["deposit_policy", v.policy], ["deposit_after_no_shows", String(v.after)], ["deposit_default_cents", String(v.cents)]] as const) {
    await query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, val]);
  }
  revalidatePath("/admin/ajustes");
  revalidatePath("/reservar");
  done("Política de señal guardada");
}

/* ---------- Packs ---------- */
const PackSchema = z.object({
  name: z.string().min(2, "El nombre del pack es muy corto").max(60),
  emoji: z.string().min(1, "Pon un emoji").max(8),
  description: z.string().max(160),
  discount: z.coerce.number().int().min(0, "El descuento va de 0 a 90 %").max(90, "El descuento va de 0 a 90 %"),
  sort: z.coerce.number().int().min(0).max(9999),
  occasion: z.string().max(40),
  people: z.coerce.number().int().refine((n) => n === 1 || n === 2, "Un pack es para 1 o 2 personas"),
});
async function parsePack(fd: FormData) {
  const r = PackSchema.safeParse({ name: str(fd, "name"), emoji: str(fd, "emoji") || "✨", description: str(fd, "description"), discount: str(fd, "discount") || "0", sort: str(fd, "sort") || "100", occasion: str(fd, "occasion"), people: str(fd, "people") || "1" });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa el pack");
  const slugs = Array.from(new Set(fd.getAll("services").map(String)));
  const people = r.data!.people;
  if (people === 1 && slugs.length < 2) fail("Un pack lleva al menos dos servicios (o elige «para dos» con uno)");
  if (slugs.length * people > 6) fail("Un pack lleva como mucho 6 servicios en total");
  const startsOn = str(fd, "starts_on") || null;
  const endsOn = str(fd, "ends_on") || null;
  if ((startsOn && !isDay(startsOn)) || (endsOn && !isDay(endsOn))) fail("Las fechas de temporada no son válidas");
  if (startsOn && endsOn && endsOn < startsOn) fail("La temporada termina antes de empezar");
  const ok = await query<{ slug: string }>(`SELECT slug FROM services WHERE slug = ANY($1::text[]) AND active`, [slugs]);
  if (ok.length !== slugs.length) fail("Alguno de los servicios no existe o está desactivado");
  return { ...r.data!, slugs, startsOn, endsOn, featured: fd.get("featured") === "on" };
}
const afterCatalog = (msg: string) => {
  revalidatePath("/admin/ajustes");
  revalidatePath("/reservar");
  done(msg);
};
export async function addPackAction(fd: FormData) {
  await guard("addPackAction");
  const p = await parsePack(fd);
  const base = slugify(p.name);
  const taken = new Set((await query<{ slug: string }>(`SELECT slug FROM packages WHERE slug LIKE $1`, [`${base}%`])).map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  await query(`INSERT INTO packages (slug, name, emoji, description, service_slugs, discount_percent, sort, occasion, people, starts_on, ends_on, featured) VALUES ($1, $2, $3, $4, $5::text[], $6::int, $7::int, NULLIF($8, ''), $9::int, $10::date, $11::date, $12)`, [slug, p.name, p.emoji, p.description || null, p.slugs, p.discount, p.sort, p.occasion, p.people, p.startsOn, p.endsOn, p.featured]);
  afterCatalog(`Pack creado: ${p.name}`);
}
export async function savePackAction(fd: FormData) {
  await guard("savePackAction");
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  const p = await parsePack(fd);
  await query(
    `UPDATE packages SET name = $2, emoji = $3, description = $4, service_slugs = $5::text[], discount_percent = $6::int, sort = $7::int, active = $8,
            occasion = NULLIF($9, ''), people = $10::int, starts_on = $11::date, ends_on = $12::date, featured = $13 WHERE id = $1::int`,
    [id, p.name, p.emoji, p.description || null, p.slugs, p.discount, p.sort, fd.get("active") === "on", p.occasion, p.people, p.startsOn, p.endsOn, p.featured],
  );
  afterCatalog(`Pack guardado: ${p.name}`);
}
export async function deletePackAction(fd: FormData) {
  await guard("deletePackAction");
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) await query(`DELETE FROM packages WHERE id = $1::int`, [id]);
  afterCatalog("Pack borrado");
}

/* ---------- Extras ---------- */
const AddonSchema = z.object({
  name: z.string().min(2, "El nombre del extra es muy corto").max(60),
  description: z.string().max(160),
  duration: z.coerce.number().int().min(5, "La duración mínima es 5 min").max(240).refine((n) => n % 5 === 0, "La duración debe ser múltiplo de 5"),
  price: z.number().int().min(0),
  category: z.string().max(60),
  sort: z.coerce.number().int().min(0).max(9999),
});
function parseAddon(fd: FormData) {
  const price = euros(str(fd, "price") || "0");
  const r = AddonSchema.safeParse({ name: str(fd, "name"), description: str(fd, "description"), duration: str(fd, "duration"), price: Number.isNaN(price) ? -1 : price, category: str(fd, "category"), sort: str(fd, "sort") || "100" });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa el extra");
  return r.data!;
}
export async function addAddonAction(fd: FormData) {
  await guard("addAddonAction");
  const a = parseAddon(fd);
  const base = slugify(a.name);
  const taken = new Set((await query<{ slug: string }>(`SELECT slug FROM addons WHERE slug LIKE $1`, [`${base}%`])).map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  await query(`INSERT INTO addons (slug, name, description, duration_min, price_cents, category, sort) VALUES ($1, $2, $3, $4::int, $5::int, $6, $7::int)`, [slug, a.name, a.description || null, a.duration, a.price, a.category || null, a.sort]);
  afterCatalog(`Extra creado: ${a.name}`);
}
export async function saveAddonAction(fd: FormData) {
  await guard("saveAddonAction");
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  const a = parseAddon(fd);
  await query(
    `UPDATE addons SET name = $2, description = $3, duration_min = $4::int, price_cents = $5::int, category = $6, sort = $7::int, active = $8 WHERE id = $1::int`,
    [id, a.name, a.description || null, a.duration, a.price, a.category || null, a.sort, fd.get("active") === "on"],
  );
  afterCatalog(`Extra guardado: ${a.name}`);
}
export async function deleteAddonAction(fd: FormData) {
  await guard("deleteAddonAction");
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) await query(`DELETE FROM addons WHERE id = $1::int`, [id]);
  afterCatalog("Extra borrado");
}

/* ---------- Fidelidad (sellos) ---------- */
export async function saveLoyaltyAction(fd: FormData) {
  await guard("saveLoyaltyAction");
  const r = z
    .object({
      every: z.coerce.number().int().min(2, "Mínimo 2 visitas").max(50, "Máximo 50 visitas"),
      reward: z.string().trim().min(3, "Escribe cuál es el premio").max(80),
    })
    .safeParse({ every: str(fd, "every") || "10", reward: str(fd, "reward") });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa el programa de fidelidad");
  const v = r.data!;
  for (const [k, val] of [["loyalty_enabled", fd.get("enabled") === "on" ? "on" : "off"], ["loyalty_every", String(v.every)], ["loyalty_reward", v.reward]] as const) {
    await query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, val]);
  }
  revalidatePath("/admin/ajustes");
  done("Programa de fidelidad guardado");
}

const put = (k: string, v: string) => query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, v]);

export async function saveGrowthAction(fd: FormData) {
  await guard("saveGrowthAction");
  const r = z
    .object({
      days: z.coerce.number().int().min(0).max(365),
      reward: z.string().trim().min(3, "Escribe cuál es el premio de «trae a una amiga»").max(80),
    })
    .safeParse({ days: str(fd, "reactivation_days") || "0", reward: str(fd, "referral_reward") });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa los datos");
  if (r.data!.days !== 0 && r.data!.days < 14) fail("Para «te echamos de menos» pon al menos 14 días (o 0 para desactivarlo)");
  await put("auto_showed", fd.get("auto_showed") === "on" ? "on" : "off");
  await put("abandon_recovery", fd.get("abandon_recovery") === "on" ? "on" : "off");
  await put("reactivation_days", String(r.data!.days));
  await put("referral_enabled", fd.get("referral_enabled") === "on" ? "on" : "off");
  await put("referral_reward", r.data!.reward);
  revalidatePath("/admin/ajustes");
  done("Automatizaciones guardadas");
}

/** Qué servicios hace cada profesional. Sin ninguno marcado = hace todos. */
export async function saveStaffSkillsAction(fd: FormData) {
  await guard("saveStaffSkillsAction");
  const id = z.coerce.number().int().positive().parse(str(fd, "staffId"));
  const ids = fd.getAll("svc").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  await query(`DELETE FROM staff_services WHERE staff_id = $1::int`, [id]);
  if (ids.length) await query(`INSERT INTO staff_services (staff_id, service_id) SELECT $1::int, s.id FROM services s WHERE s.id = ANY($2::int[])`, [id, ids]);
  revalidatePath("/admin/ajustes");
  done(ids.length ? "Habilidades guardadas" : "Hace todos los servicios");
}

export async function revokeSessionsAction() {
  await guard();
  await revokeAllSessions();
  redirect("/admin");
}


/* ------------------------------------------------------------------ */
/* Recursos compartidos (cabinas, máquinas, lavacabezas…)              */
/* ------------------------------------------------------------------ */

const ResourceSchema = z.object({
  name: z.string().trim().min(2, "Pon un nombre a la unidad").max(60),
  kind: z.string().trim().toLowerCase().min(2, "Pon el tipo de recurso (p. ej. láser, lavacabezas)").max(40),
});

export async function addResourceAction(fd: FormData) {
  await guard("addResourceAction");
  const r = ResourceSchema.safeParse({ name: str(fd, "name"), kind: str(fd, "kind") });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa la unidad");
  await query(`INSERT INTO resources (name, kind, sort) VALUES ($1, $2, COALESCE((SELECT max(sort) + 1 FROM resources), 1))`, [r.data!.name, r.data!.kind]);
  revalidatePath("/admin/ajustes");
  done(`Unidad añadida: ${r.data!.name}`);
}

export async function saveResourceAction(fd: FormData) {
  await guard("saveResourceAction");
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  const r = ResourceSchema.safeParse({ name: str(fd, "name"), kind: str(fd, "kind") });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa la unidad");
  await query(`UPDATE resources SET name = $2, kind = $3, active = $4 WHERE id = $1::int`, [id, r.data!.name, r.data!.kind, fd.get("active") === "on"]);
  revalidatePath("/admin/ajustes");
  done("Unidad guardada");
}

export async function saveDigestAction(fd: FormData) {
  await guard("saveDigestAction");
  const hour = z.coerce.number().int().min(0, "La hora va de 0 a 23").max(23, "La hora va de 0 a 23").safeParse(str(fd, "digest_hour") || "21");
  if (!hour.success) fail(hour.error.issues[0]?.message ?? "Revisa la hora");
  await put("digest_enabled", fd.get("digest_enabled") === "on" ? "on" : "off");
  await put("digest_hour", String(hour.data!));
  revalidatePath("/admin/ajustes");
  done(`Resumen diario guardado: a las ${String(hour.data).padStart(2, "0")}:00`);
}
