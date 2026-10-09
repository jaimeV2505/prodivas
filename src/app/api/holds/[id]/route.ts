import type { NextRequest } from "next/server";
import { z } from "zod";
import { releaseHold } from "@/lib/bookings";
import { respond } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await ctx.params;
    const uuid = z.string().uuid().parse(id);
    const token = z.string().min(10).parse(req.nextUrl.searchParams.get("token"));
    await releaseHold(uuid, token);
    return { ok: true };
  });
}
