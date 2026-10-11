import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { cancelByCustomer } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyOwnerCancelledOnline } from "@/lib/notify";
import { offerFreedSlot } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const { token, why } = z.object({ token: z.string().min(12), why: z.enum(["sick", "work", "other"]).optional() }).parse(await req.json());
    const booking = await cancelByCustomer(z.string().min(4).max(16).parse(code).toUpperCase(), token, why ?? null);
    after(async () => {
      await notifyOwnerCancelledOnline(booking);
      await offerFreedSlot(booking);
    });
    return { booking };
  });
}
