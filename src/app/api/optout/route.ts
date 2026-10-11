import type { NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { BookingError } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { parseOptoutToken } from "@/lib/optout";

export const dynamic = "force-dynamic";

/** Baja de los mensajes opcionales (POST: abrir el enlace no basta, para que los antivirus de correo no den de baja a nadie). */
export async function POST(req: NextRequest) {
  return respond(async () => {
    const { token } = z.object({ token: z.string().min(10).max(60) }).parse(await req.json());
    const id = parseOptoutToken(token);
    if (id === null) throw new BookingError("NOT_FOUND", "Enlace no válido.", 404);
    await query(`UPDATE customers SET optout_at = COALESCE(optout_at, now()) WHERE id = $1::int`, [id]);
    return { ok: true };
  });
}
