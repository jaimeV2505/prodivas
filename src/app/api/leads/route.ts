import type { NextRequest } from "next/server";
import { z } from "zod";
import { hashIp } from "@/lib/bookings";
import { query } from "@/lib/db";
import { clientIp, respond } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { phoneDigits } from "@/lib/site";

export const dynamic = "force-dynamic";

const Body = z.object({
  holdId: z.string().uuid(),
  holdToken: z.string().min(20),
  name: z.string().trim().max(80).optional(),
  phone: z.string().trim().regex(/^[+\d][\d\s().-]{7,17}$/, "Escribe un teléfono válido"),
  sid: z.string().max(40).optional(),
  flow: z.enum(["full", "easy"]).optional(),
  utm_source: z.string().max(60).optional(),
});

/**
 * Guarda el contacto mientras la clienta rellena sus datos. Si no termina, se le escribe UNA vez
 * (ver reminders.ts → recuperación de reservas) con un enlace para retomarla. El hueco debe estar bloqueado de verdad.
 */
export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    await limit(`lead:${hashIp(clientIp(req))}`, 20, 3600);
    const hold = await query<{ service_ids: number[]; starts_at: Date; label: string }>(
      `SELECT COALESCE((SELECT array_agg(bs.service_id ORDER BY bs.position) FILTER (WHERE bs.service_id IS NOT NULL) FROM booking_services bs WHERE bs.booking_id = b.id), ARRAY[b.service_id]) AS service_ids,
              b.starts_at,
              COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS label
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.id = $1::uuid AND b.hold_token = $2 AND b.status = 'HOLD' AND b.hold_expires_at > now()`,
      [b.holdId, b.holdToken],
    );
    const h = hold[0];
    if (!h) return { ok: true }; // el hueco ya caducó: nada que guardar
    await query(
      `INSERT INTO leads (hold_id, session_id, name, phone, phone_key, service_ids, service_label, starts_at, flow, utm_source)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::int[], $7, $8, $9, $10)
       ON CONFLICT (hold_id) WHERE hold_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, phone_key = EXCLUDED.phone_key, updated_at = now()`,
      [b.holdId, b.sid ?? null, b.name || null, b.phone, phoneDigits(b.phone).slice(-9), h.service_ids, h.label, h.starts_at, b.flow ?? "full", b.utm_source ?? null],
    );
    return { ok: true };
  });
}
