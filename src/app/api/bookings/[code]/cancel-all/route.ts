import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { cancelGroupByCustomer } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyOwnerCancelledOnline } from "@/lib/notify";
import { offerFreedSlot } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

/** Cancela de una vez todas las citas que quedan de una visita en horas distintas. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const { token, why } = z.object({ token: z.string().min(12), why: z.enum(["sick", "work", "other"]).optional() }).parse(await req.json());
    const list = await cancelGroupByCustomer(z.string().min(4).max(16).parse(code).toUpperCase(), token, why ?? null);
    after(async () => {
      for (const b of list) {
        await notifyOwnerCancelledOnline(b);
        await offerFreedSlot(b);
      }
    });
    return { cancelled: list.length };
  });
}
