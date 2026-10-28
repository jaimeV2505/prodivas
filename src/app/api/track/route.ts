import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashIp } from "@/lib/bookings";
import { query } from "@/lib/db";
import { clientIp } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const Body = z.object({
  sid: z.string().min(6).max(40).regex(/^[A-Za-z0-9_-]+$/),
  event: z.enum(["landing", "service", "slots", "hold", "details", "lead", "confirmed"]),
  flow: z.enum(["full", "easy", "hero"]).optional(),
  services: z.string().max(200).optional(),
  utm_source: z.string().max(60).optional(),
  utm_medium: z.string().max(60).optional(),
  utm_campaign: z.string().max(60).optional(),
  referrer: z.string().max(80).optional(),
  device: z.enum(["mobile", "desktop"]).optional(),
  meta: z.record(z.unknown()).optional(),
});

/** Medición anónima del embudo. Nunca devuelve error a la pantalla: medir no puede romper una reserva. */
export async function POST(req: NextRequest) {
  try {
    const b = Body.parse(await req.json());
    // «confirmed» solo lo apunta el servidor al confirmar de verdad (así nadie falsea la conversión)
    if (b.event === "confirmed") return NextResponse.json({ ok: true });
    if (!(await allow(`track:${hashIp(clientIp(req))}`, 240, 3600)) || !(await allow(`track-sid:${b.sid}`, 60, 3600))) return NextResponse.json({ ok: true });
    await query(
      `INSERT INTO funnel_events (session_id, event, flow, service_slugs, utm_source, utm_medium, utm_campaign, referrer, device, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [b.sid, b.event, b.flow ?? null, b.services ?? null, b.utm_source ?? null, b.utm_medium ?? null, b.utm_campaign ?? null, b.referrer ?? null, b.device ?? null, b.meta ? JSON.stringify(b.meta).slice(0, 500) : null],
    );
  } catch {
    /* se ignora */
  }
  return NextResponse.json({ ok: true });
}
