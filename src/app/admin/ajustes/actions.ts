"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

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
    `UPDATE services SET name = $2, category = $3, duration_min = $4, price_cents = $5, slot_step_min = $6, sort = $7, active = $8 WHERE id = $1::int`,
    [id, s.name, s.category, s.duration, s.price, s.step, s.sort, fd.get("active") === "on"],
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
    `INSERT INTO services (slug, name, category, duration_min, price_cents, slot_step_min, sort, active) VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
    [slug, s.name, s.category, s.duration, s.price, s.step, s.sort],
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
