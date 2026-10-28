"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { isAdmin, loginAdmin, logoutAdmin } from "@/lib/auth";
import { addTimeOff, adminCancel, BookingError, closeDay, createManualBooking, getSummaryById, markAttendance, removeTimeOff, rescheduleBooking } from "@/lib/bookings";
import { notifyCancelledByCentre, notifyDayClosed, notifyOwnerRepeatOffender, notifyRescheduled } from "@/lib/notify";
import { settleDeposit } from "@/lib/payments";
import { query } from "@/lib/db";
import { getLoyalty } from "@/lib/loyalty";
import { offerDay, offerFreedSlot } from "@/lib/waitlist";
import { isDay } from "@/lib/dates";
import { CONFIG } from "@/lib/config";

async function guard(action?: string) {
  if (!(await isAdmin())) redirect("/admin");
  if (action && !READ_ONLY.has(action)) await audit(action);
}
const READ_ONLY = new Set<string>([]);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (day: string, err?: string) =>
  redirect(`/admin?d=${day}${err ? `&err=${encodeURIComponent(err)}` : ""}`);

export async function login(fd: FormData) {
  const r = await loginAdmin(str(fd, "password"));
  redirect(r.ok ? "/admin" : `/admin?err=${encodeURIComponent(r.error ?? "Contraseña incorrecta")}`);
}

export async function logout() {
  await logoutAdmin();
  redirect("/admin");
}

export async function cancelBookingAction(fd: FormData) {
  await guard("cancelBookingAction");
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
  await guard("createManualAction");
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
  await guard("addTimeOffAction");
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

/**
 * «Cerrar el día»: bloquea el día entero y deja todas sus citas «por mover». A cada clienta le llega un mensaje con
 * un enlace para elegir otra hora (con 3 propuestas) o cancelar sin coste (si pagó señal, se le devuelve).
 */
export async function closeDayAction(fd: FormData) {
  await guard("closeDayAction");
  const day = str(fd, "day");
  if (!isDay(day)) back("", "Fecha no válida.");
  if (fd.get("confirm") !== "on") back(day, "Marca la casilla para confirmar que quieres cerrar el día.");
  const note = str(fd, "note").slice(0, 160) || null;
  let msg: string;
  try {
    const list = await closeDay({ day, note });
    // avisos de cinco en cinco, para no saturar los proveedores de mensajes
    for (let i = 0; i < list.length; i += 5) await Promise.all(list.slice(i, i + 5).map((b) => notifyDayClosed(b, note).catch((e) => console.error("[closeDay:notify]", e))));
    msg = list.length ? `Día cerrado: ${list.length} clienta${list.length === 1 ? "" : "s"} avisada${list.length === 1 ? "" : "s"} para mover su cita.` : "Día cerrado. No había citas ese día.";
  } catch (e) {
    console.error("[closeDay]", e);
    back(day, "No se pudo cerrar el día. Inténtalo de nuevo.");
  }
  revalidatePath("/admin");
  redirect(`/admin?d=${day}&ok=${encodeURIComponent(msg!)}`);
}

export async function removeTimeOffAction(fd: FormData) {
  await guard("removeTimeOffAction");
  await removeTimeOff(Number(str(fd, "id")));
  revalidatePath("/admin");
  back(str(fd, "day"));
}

export async function removeWaitlistAction(fd: FormData) {
  await guard("removeWaitlistAction");
  const id = z.string().uuid().parse(str(fd, "id"));
  await query(`UPDATE waitlist SET status = 'CANCELLED' WHERE id = $1::uuid`, [id]);
  revalidatePath("/admin");
  back(str(fd, "day"));
}

export async function doneCallbackAction(fd: FormData) {
  await guard("doneCallbackAction");
  await query(`UPDATE callbacks SET status = 'DONE' WHERE id = $1::bigint`, [z.coerce.number().int().positive().parse(str(fd, "id"))]);
  revalidatePath("/admin");
  back(str(fd, "day"));
}

/* ---------- Fase 2: asistencia, cambio de hora, señal y fichas ---------- */

export async function attendanceAction(fd: FormData) {
  await guard("attendanceAction");
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
  await guard("adminRescheduleAction");
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
  await guard("refundDepositAction");
  const id = z.string().uuid().parse(str(fd, "id"));
  const r = await settleDeposit(id, "refund");
  revalidatePath("/admin");
  redirect(`/admin/cita/${id}?${r === "refunded" ? "ok=Se%20ha%20devuelto%20la%20se%C3%B1al" : `err=${encodeURIComponent("No se pudo devolver la señal (¿ya devuelta o sin pago?)")}`}`);
}

export async function saveCustomerNotesAction(fd: FormData) {
  await guard("saveCustomerNotesAction");
  const id = z.coerce.number().int().positive().parse(str(fd, "id"));
  await query(`UPDATE customers SET notes = $2 WHERE id = $1::bigint`, [id, str(fd, "notes").slice(0, 2000) || null]);
  revalidatePath(`/admin/clientas/${id}`);
  redirect(`/admin/clientas/${id}?ok=Notas%20guardadas`);
}

/** «Ofrecer a la lista»: avisa a quienes esperan de que hay huecos libres ese día (por orden de llegada, solo si les cabe su servicio). */
export async function offerDayAction(fd: FormData) {
  await guard("offerDayAction");
  const day = str(fd, "day");
  if (!isDay(day)) redirect("/admin");
  let n = 0;
  try {
    n = await offerDay(day, 10);
  } catch (e) {
    console.error("[offerDay]", e);
    redirect(`/admin/ofrecer?d=${day}&err=${encodeURIComponent("No se pudo avisar. Inténtalo de nuevo.")}`);
  }
  redirect(`/admin/ofrecer?d=${day}&ok=${encodeURIComponent(n ? `Avisadas ${n} persona${n === 1 ? "" : "s"} de la lista de espera.` : "Nadie de la lista encaja con los huecos libres de ese día.")}`);
}

/** Canjea un premio de fidelidad (solo si tiene alguno pendiente): la tarjeta vuelve a empezar. */
export async function redeemLoyaltyAction(fd: FormData) {
  await guard("redeemLoyaltyAction");
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) redirect("/admin/clientas");
  const l = await getLoyalty();
  const r = await query<{ id: number }>(
    `UPDATE customers SET loyalty_redeemed = loyalty_redeemed + 1 WHERE id = $1::bigint AND floor(visit_count::numeric / $2::int) > loyalty_redeemed RETURNING id`,
    [id, l.every],
  );
  revalidatePath(`/admin/clientas/${id}`);
  redirect(`/admin/clientas/${id}?ok=${encodeURIComponent(r.length ? `Premio canjeado: ${l.reward}.` : "No tiene premios pendientes.")}`);
}

export async function redeemReferralAction(fd: FormData) {
  await guard("redeemReferralAction");
  const id = Number(str(fd, "id"));
  if (!Number.isInteger(id) || id <= 0) redirect("/admin/clientas");
  const r = await query<{ id: number }>(
    `UPDATE customers SET referral_redeemed = referral_redeemed + 1 WHERE id = $1::bigint AND referral_rewards > referral_redeemed RETURNING id`,
    [id],
  );
  revalidatePath(`/admin/clientas/${id}`);
  redirect(`/admin/clientas/${id}?ok=${encodeURIComponent(r.length ? "Premio por amiga canjeado." : "No tiene premios por amigas pendientes.")}`);
}
