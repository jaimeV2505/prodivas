import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { transferBooking } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyBookingCreated, notifyOwnerRaw } from "@/lib/notify";

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().min(12),
  name: z.string().trim().min(2, "Escribe su nombre").max(80),
  phone: z.string().trim().regex(/^[+\d][\d\s().-]{7,17}$/, "Escribe un teléfono válido"),
});

/** «Ceder mi cita»: pasa a otra persona, que recibe su propio enlace. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const b = Body.parse(await req.json());
    const r = await transferBooking({ code: z.string().min(4).max(16).parse(code).toUpperCase(), token: b.token, name: b.name, phone: b.phone });
    after(async () => {
      await notifyBookingCreated(r.booking); // la nueva persona recibe su confirmación y su enlace
      await notifyOwnerRaw(`🔁 Cita cedida: ${r.oldName ?? "una clienta"} → ${r.booking.customerName} (${r.booking.customerPhone}). ${r.booking.serviceName}.`, "Cita cedida", r.booking.id);
    });
    return { name: r.booking.customerName };
  });
}
