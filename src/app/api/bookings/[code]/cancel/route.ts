import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { cancelByCustomer } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyBooking } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const { token } = z.object({ token: z.string().min(20) }).parse(await req.json());
    const booking = await cancelByCustomer(z.string().min(4).max(16).parse(code), token);
    after(() => notifyBooking(booking, "cancelled"));
    return { booking };
  });
}
