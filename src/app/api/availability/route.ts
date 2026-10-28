import type { NextRequest } from "next/server";
import { z } from "zod";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { getCapacity, getSlotRows, groupSlots } from "@/lib/availability";
import { BookingError, bookingVisitMetrics, getBookingByCode } from "@/lib/bookings";
import { query, run } from "@/lib/db";
import { loadVisit } from "@/lib/visit";
import { clientIp, respond } from "@/lib/http";
import { hashIp } from "@/lib/bookings";
import { limit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const Params = z.object({
  serviceId: z.coerce.number().int().positive().optional(),
  serviceIds: z
    .string()
    .regex(/^\d+(,\d+){0,5}$/, "Servicios no válidos")
    .optional(),
  addonIds: z
    .string()
    .regex(/^\d+(,\d+){0,5}$/, "Extras no válidos")
    .optional(),
  exclude: z.string().max(16).optional(), // código de una cita (para ofrecer también su propio hueco)
  t: z.string().max(80).optional(), // token de esa cita
  holdId: z.string().uuid().optional(), // bloqueo propio de la clienta: no cuenta como ocupado para ella
  holdToken: z.string().max(80).optional(),
  staffId: z.coerce.number().int().positive().optional(),
  from: z.string().refine(isDay, "Fecha no válida"),
  to: z.string().refine(isDay, "Fecha no válida"),
});

export async function GET(req: NextRequest) {
  return respond(async () => {
    await limit(`avail:${hashIp(clientIp(req))}`, 150, 60, "Vas muy rápido. Espera unos segundos.");
    const p = Params.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ids = p.serviceIds ? p.serviceIds.split(",").map(Number) : p.serviceId ? [p.serviceId] : [];
    if (!ids.length) throw new BookingError("INVALID", "Falta el servicio.", 400);
    const addonIds = p.addonIds ? p.addonIds.split(",").map(Number) : [];
    const visit = await loadVisit(ids, run, addonIds);
    let excludeBookingId: string | null = null;
    let metrics: { duration: number; buffer: number; step: number; serviceIds: number[]; pattern: import("@/lib/blocks").Pattern } = { duration: visit.durationMin, buffer: visit.bufferMin, step: visit.stepMin, serviceIds: visit.items.map((i) => i.id), pattern: visit.pattern };
    if (p.exclude && p.t) {
      const bk = await getBookingByCode(p.exclude.toUpperCase(), p.t);
      if (bk && bk.status === "CONFIRMED") {
        excludeBookingId = bk.id;
        // al cambiar la hora de una cita, la duración sale de la propia cita (incluye sus extras)
        metrics = await bookingVisitMetrics(run, bk.id, visit.durationMin);
      }
    } else if (p.holdId && p.holdToken) {
      // Así los huecos que se solapan con su propia selección siguen disponibles para moverla (no parecen «ocupados»)
      const own = await query<{ id: string }>(
        `SELECT id FROM bookings WHERE id = $1::uuid AND hold_token = $2 AND status = 'HOLD' AND hold_expires_at > now()`,
        [p.holdId, p.holdToken],
      );
      if (own[0]) excludeBookingId = own[0].id;
    }

    const today = todayIn(CONFIG.tz);
    const maxDay = addDays(today, CONFIG.maxDaysAhead);
    const from = p.from < today ? today : p.from;
    const to = p.to > maxDay ? maxDay : p.to;
    if (from > to) return { slots: [], capacity: 0 };

    const [rows, capacity] = await Promise.all([
      getSlotRows({
        from,
        to,
        durationMin: metrics.duration,
        bufferMin: metrics.buffer,
        stepMin: metrics.step,
        staffId: p.staffId ?? null,
        excludeBookingId,
        serviceIds: metrics.serviceIds,
        pattern: metrics.pattern,
      }),
      getCapacity({ from, to, durationMin: metrics.duration, bufferMin: metrics.buffer, staffId: p.staffId ?? null, serviceIds: metrics.serviceIds, pattern: metrics.pattern, stepMin: metrics.step }),
    ]);
    return { slots: groupSlots(rows), capacity };
  });
}
