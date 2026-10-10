import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { rescheduleBooking } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyRescheduled } from "@/lib/notify";
import { offerFreedSlot } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

/** La clienta cambia la hora de su cita desde su enlace. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const b = z
      .object({ token: z.string().min(12), startsAt: z.string().datetime({ offset: true }) })
      .parse(await req.json());
    const r = await rescheduleBooking({ code: z.string().min(4).max(16).parse(code).toUpperCase(), token: b.token, startsAt: b.startsAt });
    after(async () => {
      await notifyRescheduled(r.booking, r.old.startsAt);
      // El hueco anterior queda libre: se ofrece a la lista de espera
      await offerFreedSlot({ ...r.booking, startsAt: r.old.startsAt, endsAt: r.old.endsAt });
    });
    return { booking: r.booking };
  });
}
