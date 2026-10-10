import type { NextRequest } from "next/server";
import { z } from "zod";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { getCapacity, getSlotRows, groupSlots } from "@/lib/availability";
import { BookingError } from "@/lib/bookings";
import { query } from "@/lib/db";
import { respond } from "@/lib/http";

export const dynamic = "force-dynamic";

const Params = z.object({
  serviceId: z.coerce.number().int().positive(),
  staffId: z.coerce.number().int().positive().optional(),
  from: z.string().refine(isDay, "Fecha no válida"),
  to: z.string().refine(isDay, "Fecha no válida"),
});

export async function GET(req: NextRequest) {
  return respond(async () => {
    const p = Params.parse(Object.fromEntries(req.nextUrl.searchParams));
    const svc = (
      await query<{ duration_min: number; step_min: number }>(
        `SELECT duration_min, COALESCE(slot_step_min, duration_min) AS step_min FROM services WHERE id = $1 AND active`,
        [p.serviceId],
      )
    )[0];
    if (!svc) throw new BookingError("NOT_FOUND", "Servicio no encontrado.", 404);

    const today = todayIn(CONFIG.tz);
    const maxDay = addDays(today, CONFIG.maxDaysAhead);
    const from = p.from < today ? today : p.from;
    const to = p.to > maxDay ? maxDay : p.to;
    if (from > to) return { slots: [], capacity: 0 };

    const [rows, capacity] = await Promise.all([
      getSlotRows({ from, to, durationMin: svc.duration_min, stepMin: svc.step_min, staffId: p.staffId ?? null }),
      getCapacity({ from, to, durationMin: svc.duration_min, staffId: p.staffId ?? null }),
    ]);
    return { slots: groupSlots(rows), capacity };
  });
}
