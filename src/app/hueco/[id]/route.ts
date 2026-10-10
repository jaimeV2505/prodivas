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
    const rows = await query<{ ids: number[]; day: string | null; source: string }>(
      `SELECT COALESCE(w.service_ids, ARRAY[w.service_id]) AS ids, to_char(w.day, 'YYYY-MM-DD') AS day, w.source
       FROM waitlist w WHERE w.id = $1::uuid`,
      [parsed.data],
    );
    const w = rows[0];
    if (w) {
      const slugs = await query<{ slug: string }>(
        `SELECT slug FROM services WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id)`,
        [w.ids],
      );
      if (slugs[0]) {
        const qs = new URLSearchParams({ servicio: slugs[0].slug });
        if (slugs.length > 1 && w.source !== "app") qs.set("extra", slugs.slice(1).map((x) => x.slug).join(","));
        if (w.day) qs.set("dia", w.day);
        path = `${w.source === "app" ? "/cita" : "/reservar"}?${qs}`;
      }
    }
  }
  return NextResponse.redirect(new URL(path, req.nextUrl.origin));
}
