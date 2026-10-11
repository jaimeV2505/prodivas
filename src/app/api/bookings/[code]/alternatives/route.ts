import type { NextRequest } from "next/server";
import { z } from "zod";
import { suggestAlternatives } from "@/lib/bookings";
import { respond } from "@/lib/http";

export const dynamic = "force-dynamic";

/** «¿Mejor la movemos?»: hasta 3 huecos libres parecidos a la cita. (GET sin efectos.) */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const t = z.string().min(12).max(80).parse(req.nextUrl.searchParams.get("t"));
    return { alternatives: await suggestAlternatives(z.string().min(4).max(16).parse(code).toUpperCase(), t, 3) };
  });
}
