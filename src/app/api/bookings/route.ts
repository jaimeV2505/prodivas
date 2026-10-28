import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { guardConfirm } from "@/lib/abuse";
import { BookingError, confirmBooking } from "@/lib/bookings";
import { markLeadsBooked, recordConfirmed } from "@/lib/funnel";
import { registerReferral } from "@/lib/referrals";
import { respond } from "@/lib/http";
import { notifyBookingCreated, notifyOwnerRepeatOffender } from "@/lib/notify";
import { markWaitlistBooked } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const Body = z.object({
  holdId: z.string().uuid(),
  holdToken: z.string().min(20),
  name: z.string().trim().min(2, "Escribe tu nombre").max(80),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s().-]{7,17}$/, "Escribe un teléfono válido"),
  email: z.string().trim().email("Revisa tu email").max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional(),
  acks: z.array(z.enum(["laser", "microblading"])).max(4).optional(), // casillas de seguridad marcadas
  website: z.string().optional(), // honeypot: las personas no lo ven ni lo rellenan
  otp: z.string().regex(/^\d{6}$/).optional(), // código de verificación del teléfono
  attr: z.object({ sid: z.string().max(40).optional(), utm_source: z.string().max(60).optional(), utm_medium: z.string().max(60).optional(), utm_campaign: z.string().max(60).optional(), ref: z.string().max(12).optional(), flow: z.string().max(8).optional() }).optional(),
});

export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    if (b.website) throw new BookingError("INVALID", "No hemos podido procesar la solicitud.");
    await guardConfirm(req, b.phone, b.otp);
    const r = await confirmBooking({
      holdId: b.holdId,
      holdToken: b.holdToken,
      name: b.name,
      phone: b.phone,
      email: b.email || null,
      notes: b.notes || null,
      acks: b.acks,
    });
    // Con señal pendiente se devuelve el enlace de pago; los avisos salen cuando Stripe confirma el pago
    if (r.checkoutUrl) return { booking: r.booking, checkoutUrl: r.checkoutUrl };
    after(async () => {
      await recordConfirmed([r.booking.id], b.attr, r.booking.serviceName);
      await markLeadsBooked(r.booking.customerPhone);
      await registerReferral(r.booking.customerPhone, b.attr?.ref);
      await notifyBookingCreated(r.booking);
      await markWaitlistBooked(r.booking.customerPhone, r.booking.startsAt);
      if (r.noShowCount >= Number(process.env.NO_SHOW_ALERT ?? 2)) await notifyOwnerRepeatOffender(r.booking, r.noShowCount);
    });
    return { booking: r.booking };
  });
}
