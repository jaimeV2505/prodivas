import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { BookingError, hashIp } from "@/lib/bookings";
import { query } from "@/lib/db";
import { clientIp, respond } from "@/lib/http";
import { notifyOwnerCallback } from "@/lib/notify";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(2, "Escribe tu nombre").max(80),
  phone: z.string().trim().regex(/^[+\d][\d\s().-]{7,17}$/, "Escribe un teléfono válido"),
  website: z.string().optional(), // honeypot
});

// "Que me llamen": para quien no se maneja con la app. Máximo 3 por IP y día para evitar abusos.
export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    if (b.website) throw new BookingError("INVALID", "No hemos podido procesar la solicitud.");
    const ip = hashIp(clientIp(req));
    const n = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM callbacks WHERE ip_hash = $1 AND created_at > now() - interval '24 hours'`,
      [ip],
    );
    if (n[0].n >= 3) throw new BookingError("INVALID", "Ya nos has avisado. Te llamaremos lo antes posible.", 429);
    await query(`INSERT INTO callbacks (name, phone, ip_hash) VALUES ($1, $2, $3)`, [b.name, b.phone, ip]);
    after(() => notifyOwnerCallback({ name: b.name, phone: b.phone }));
    return { ok: true };
  });
}
