"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAdmin, loginAdmin, logoutAdmin } from "@/lib/auth";
import { addTimeOff, adminCancel, BookingError, createManualBooking, getSummaryById, removeTimeOff } from "@/lib/bookings";
import { notifyCancelledByCentre } from "@/lib/notify";
import { query } from "@/lib/db";
import { offerFreedSlot } from "@/lib/waitlist";
import { isDay } from "@/lib/dates";

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
