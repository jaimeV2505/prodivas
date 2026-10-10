import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Enlace corto de los avisos de "se ha liberado un hueco": lleva a reservar ese servicio y ese día. (GET sin efectos.) */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = z.string().uuid().safeParse(id);
  let path = "/reservar";
  if (parsed.success) {
    const rows = await query<{ slug: string; day: string | null; source: string }>(
      `SELECT s.slug, to_char(w.day, 'YYYY-MM-DD') AS day, w.source
       FROM waitlist w JOIN services s ON s.id = w.service_id WHERE w.id = $1::uuid`,
      [parsed.data],
    );
    const w = rows[0];
    if (w) {
      const qs = new URLSearchParams({ servicio: w.slug });
      if (w.day) qs.set("dia", w.day);
      path = `${w.source === "app" ? "/cita" : "/reservar"}?${qs}`;
    }
  }
  return NextResponse.redirect(new URL(path, req.nextUrl.origin));
}
