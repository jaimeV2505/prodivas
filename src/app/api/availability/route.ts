import type { NextRequest } from "next/server";
import { z } from "zod";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { getCapacity, getSlotRows, groupSlots } from "@/lib/availability";
import { BookingError, getBookingByCode } from "@/lib/bookings";
import { query } from "@/lib/db";
import { loadVisit } from "@/lib/visit";
import { respond } from "@/lib/http";

export const dynamic = "force-dynamic";

const Params = z.object({
  serviceId: z.coerce.number().int().positive().optional(),
  serviceIds: z
    .string()
    .regex(/^\d+(,\d+){0,3}$/, "Servicios no válidos")
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
    const p = Params.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ids = p.serviceIds ? p.serviceIds.split(",").map(Number) : p.serviceId ? [p.serviceId] : [];
    if (!ids.length) throw new BookingError("INVALID", "Falta el servicio.", 400);
    const visit = await loadVisit(ids);
    let excludeBookingId: string | null = null;
    if (p.exclude && p.t) {
      const bk = await getBookingByCode(p.exclude.toUpperCase(), p.t);
      if (bk && bk.status === "CONFIRMED") excludeBookingId = bk.id;
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
        durationMin: visit.durationMin,
        bufferMin: visit.bufferMin,
        stepMin: visit.stepMin,
        staffId: p.staffId ?? null,
        excludeBookingId,
      }),
      getCapacity({ from, to, durationMin: visit.durationMin, bufferMin: visit.bufferMin, staffId: p.staffId ?? null }),
    ]);
    return { slots: groupSlots(rows), capacity };
  });
}
