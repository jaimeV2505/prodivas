"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { enabled, sendEmail, sendSms, sendTelegram, sendWhatsAppTemplate, type SendResult } from "@/lib/messaging";

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}
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
  });
  if (!r.success) fail(r.error.issues[0]?.message ?? "Revisa los datos del servicio");
  return r.data!;
}

export async function saveModeAction(fd: FormData) {
  await guard();
  const mode = z.enum(["smart", "compact", "flex"]).safeParse(str(fd, "mode"));
  if (!mode.success) fail("Modo no válido");
  await query(`INSERT INTO settings (key, value) VALUES ('slot_mode', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [mode.data!]);
  revalidatePath("/admin/ajustes");
  done("Modo de huecos guardado");
}

export async function saveServiceAction(fd: FormData) {
  await guard();
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  const s = parseService(fd);
  await query(
    `UPDATE services SET name = $2, category = $3, duration_min = $4, price_cents = $5, slot_step_min = $6, sort = $7, active = $8,
                         buffer_min = $9, deposit_cents = LEAST($10::int, $5::int) WHERE id = $1::int`,
    [id, s.name, s.category, s.duration, s.price, s.step, s.sort, fd.get("active") === "on", s.buffer, s.deposit],
  );
  revalidatePath("/admin/ajustes");
  done(`Guardado: ${s.name}`);
}

export async function addServiceAction(fd: FormData) {
  await guard();
  const s = parseService(fd);
  const base = slugify(s.name);
  const taken = new Set((await query<{ slug: string }>(`SELECT slug FROM services WHERE slug LIKE $1`, [`${base}%`])).map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  await query(
    `INSERT INTO services (slug, name, category, duration_min, price_cents, slot_step_min, sort, active, buffer_min, deposit_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, LEAST($9::int, $5::int))`,
    [slug, s.name, s.category, s.duration, s.price, s.step, s.sort, s.buffer, s.deposit],
  );
  revalidatePath("/admin/ajustes");
  done(`Servicio creado: ${s.name}`);
}

const hhmm = /^\d{2}:\d{2}$/;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export async function saveHoursAction(fd: FormData) {
  await guard();
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
  await guard();
  const name = z.string().min(2, "Pon un nombre").max(60).safeParse(str(fd, "name"));
  if (!name.success) fail(name.error.issues[0]?.message ?? "Nombre no válido");
  await query(`INSERT INTO staff (name, sort) VALUES ($1, COALESCE((SELECT max(sort) + 1 FROM staff), 1))`, [name.data!]);
  revalidatePath("/admin/ajustes");
  done(`Profesional añadida: ${name.data}`);
}

export async function saveStaffAction(fd: FormData) {
  await guard();
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
  await guard();
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
  await guard();
  const staffId = z.coerce.number().int().positive().parse(str(fd, "staffId"));
  await query(`DELETE FROM staff_hours WHERE staff_id = $1::int`, [staffId]);
  revalidatePath("/admin/ajustes");
  done("Vuelve a seguir el horario del salón");
}

/* ---------- Probar los canales de aviso ---------- */

export async function testChannelAction(fd: FormData) {
  await guard();
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
  await guard();
  const t = await parseTrend(fd);
  await query(`INSERT INTO trends (emoji, title, body, topic, service_slug, sort) VALUES ($1, $2, $3, $4, $5, $6::int)`, [t.emoji, t.title, t.body, t.topic, t.serviceSlug, t.sort]);
  afterTrend("Tendencia añadida");
}

export async function saveTrendAction(fd: FormData) {
  await guard();
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
  await guard();
  const id = Number(str(fd, "id"));
  if (Number.isInteger(id)) await query(`DELETE FROM trends WHERE id = $1::int`, [id]);
  afterTrend("Tendencia borrada");
}
