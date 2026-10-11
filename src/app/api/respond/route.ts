import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { respondToBooking } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyOwnerResponse } from "@/lib/notify";
import { offerFreedSlot } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const Body = z.object({
  code: z.string().min(4).max(16),
  token: z.string().min(12),
  action: z.enum(["confirm", "cancel"]),
  why: z.enum(["sick", "work", "other"]).optional(), // motivo, en un toque (opcional)
});

// POST (nunca GET): los antivirus de correo "abren" los enlaces y no deben confirmar ni cancelar nada.
export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    const r = await respondToBooking({ code: b.code.toUpperCase(), token: b.token, action: b.action, why: b.why ?? null });
    if (r.changed && r.state !== "already_cancelled") {
      after(async () => {
        await notifyOwnerResponse(r.booking, r.state as "confirmed" | "cancelled");
        if (r.state === "cancelled") await offerFreedSlot(r.booking);
      });
    }
    return { state: r.state, startsAt: r.booking.startsAt, serviceName: r.booking.serviceName };
  });
}
