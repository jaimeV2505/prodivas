"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAdmin, loginAdmin, logoutAdmin } from "@/lib/auth";
import { addTimeOff, adminCancel, BookingError, createManualBooking, getSummaryById, markAttendance, removeTimeOff, rescheduleBooking } from "@/lib/bookings";
import { notifyCancelledByCentre, notifyOwnerRepeatOffender, notifyRescheduled } from "@/lib/notify";
import { settleDeposit } from "@/lib/payments";
import { query } from "@/lib/db";
import { offerFreedSlot } from "@/lib/waitlist";
import { isDay } from "@/lib/dates";
import { CONFIG } from "@/lib/config";

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (day: string, err?: string) =>
  redirect(`/admin?d=${day}${err ? `&err=${encodeURIComponent(err)}` : ""}`);

export async function login(fd: FormData) {
  const ok = await loginAdmin(str(fd, "password"));
  redirect(ok ? "/admin" : "/admin?err=Contraseña%20incorrecta");
}

export async function logout() {
  await logoutAdmin();
  redirect("/admin");
}

export async function cancelBookingAction(fd: FormData) {
  await guard();
  const id = z.string().uuid().parse(str(fd, "id"));
  const before = await getSummaryById(id);
  await adminCancel(id);
  if (before && before.status === "CONFIRMED") {
    after(async () => {
      if (before.customerPhone) await notifyCancelledByCentre(before);
      await offerFreedSlot(before);
    });
  }
  revalidatePath("/admin");
  back(str(fd, "day"));
}

export async function createManualAction(fd: FormData) {
  await guard();
  const day = str(fd, "day");
  let error: string | undefined;
  try {
    const p = z
      .object({
        serviceId: z.coerce.number().int().positive(),
        staffId: z.coerce.number().int().positive(),
        day: z.string().refine(isDay),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        name: z.string().min(2).max(80),
        phone: z.string().min(6).max(30),
        notes: z.string().max(500).optional(),
      })
      .parse({
        serviceId: str(fd, "serviceId"),
        staffId: str(fd, "staffId"),
        day,
        time: str(fd, "time"),
        name: str(fd, "name"),
        phone: str(fd, "phone"),
        notes: str(fd, "notes"),
      });
    await createManualBooking(p);
  } catch (e) {
    error = e instanceof BookingError ? e.message : "Revisa los datos de la cita.";
  }
  revalidatePath("/admin");
  back(isDay(day) ? day : "", error);
}

export async function addTimeOffAction(fd: FormData) {
  await guard();
  const day = str(fd, "day");
  let error: string | undefined;
  try {
    if (!isDay(day)) throw new Error("fecha");
    const staff = str(fd, "staffId");
    await addTimeOff({
      staffId: staff ? Number(staff) : null,
      day,
      from: str(fd, "from") || null,
      to: str(fd, "to") || null,
      reason: str(fd, "reason") || null,
    });
  } catch {
    error = "No se pudo bloquear ese horario. Revisa fecha y horas.";
  }
  revalidatePath("/admin");
  back(isDay(day) ? day : "", error);
}

export async function removeTimeOffAction(fd: FormData) {
  await guard();
  await removeTimeOff(Number(str(fd, "id")));
  revalidatePath("/admin");
  back(str(fd, "day"));
}

export async function removeWaitlistAction(fd: FormData) {
  await guard();
  const id = z.string().uuid().parse(str(fd, "id"));
  await query(`UPDATE waitlist SET status = 'CANCELLED' WHERE id = $1::uuid`, [id]);
  revalidatePath("/admin");
  back(str(fd, "day"));
}

export async function doneCallbackAction(fd: FormData) {
  await guard();
  await query(`UPDATE callbacks SET status = 'DONE' WHERE id = $1::bigint`, [z.coerce.number().int().positive().parse(str(fd, "id"))]);
  revalidatePath("/admin");
  back(str(fd, "day"));
}

/* ---------- Fase 2: asistencia, cambio de hora, señal y fichas ---------- */

export async function attendanceAction(fd: FormData) {
  await guard();
  const id = z.string().uuid().parse(str(fd, "id"));
  const v = z.enum(["SHOWED", "NO_SHOW", "CLEAR"]).parse(str(fd, "value"));
  let error: string | undefined;
  try {
    const r = await markAttendance(id, v === "CLEAR" ? null : v);
    if (v === "NO_SHOW" && r.noShowCount !== null && r.noShowCount >= Number(process.env.NO_SHOW_ALERT ?? 2)) {
      after(() => notifyOwnerRepeatOffender(r.booking, r.noShowCount ?? 0));
    }
  } catch (e) {
    error = e instanceof BookingError ? e.message : "No se pudo guardar la asistencia.";
  }
  revalidatePath("/admin");
  const next = str(fd, "next") || "/admin";
  redirect(error ? `${next}${next.includes("?") ? "&" : "?"}err=${encodeURIComponent(error)}` : next);
}

export async function adminRescheduleAction(fd: FormData) {
  await guard();
  const id = z.string().uuid().parse(str(fd, "id"));
  let error: string | undefined;
  try {
    const p = z
      .object({ day: z.string().refine(isDay), time: z.string().regex(/^\d{2}:\d{2}$/), staffId: z.coerce.number().int().positive() })
      .parse({ day: str(fd, "day"), time: str(fd, "time"), staffId: str(fd, "staffId") });
    const iso = ((await query<{ s: string }>(`SELECT to_char((($1::date + $2::time) AT TIME ZONE $3::text) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS s`, [p.day, p.time, CONFIG.tz])))[0].s;
    const r = await rescheduleBooking({ bookingId: id, startsAt: iso, staffId: p.staffId, admin: true });
    const tell = fd.get("notify") === "on";
    after(async () => {
      await notifyRescheduled(r.booking, r.old.startsAt, tell && !!r.booking.customerPhone);
      await offerFreedSlot({ ...r.booking, startsAt: r.old.startsAt, endsAt: r.old.endsAt });
    });
  } catch (e) {
    error = e instanceof BookingError ? e.message : "Revisa el día y la hora.";
  }
  revalidatePath("/admin");
  redirect(`/admin/cita/${id}${error ? `?err=${encodeURIComponent(error)}` : "?ok=Hora%20cambiada"}`);
}

export async function refundDepositAction(fd: FormData) {
  await guard();
  const id = z.string().uuid().parse(str(fd, "id"));
  const r = await settleDeposit(id, "refund");
  revalidatePath("/admin");
  redirect(`/admin/cita/${id}?${r === "refunded" ? "ok=Se%20ha%20devuelto%20la%20se%C3%B1al" : `err=${encodeURIComponent("No se pudo devolver la señal (¿ya devuelta o sin pago?)")}`}`);
}

export async function saveCustomerNotesAction(fd: FormData) {
  await guard();
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  await query(`UPDATE customers SET notes = $2 WHERE id = $1::bigint`, [id, str(fd, "notes").slice(0, 2000) || null]);
  revalidatePath(`/admin/clientas/${id}`);
  redirect(`/admin/clientas/${id}?ok=Notas%20guardadas`);
}
