import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { guardConfirm } from "@/lib/abuse";
import { BookingError, confirmGroup } from "@/lib/bookings";
import { markLeadsBooked, recordConfirmed } from "@/lib/funnel";
import { registerReferral } from "@/lib/referrals";
import { respond } from "@/lib/http";
import { notifyGroupCreated, notifyOwnerRepeatOffender } from "@/lib/notify";
import { markWaitlistBooked } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const Body = z.object({
  legs: z.array(z.object({ holdId: z.string().uuid(), holdToken: z.string().min(20) })).min(2, "Faltan citas").max(4),
  name: z.string().trim().min(2, "Escribe tu nombre").max(80),
  phone: z.string().trim().regex(/^[+\d][\d\s().-]{7,17}$/, "Escribe un teléfono válido"),
  email: z.string().trim().email("Revisa tu email").max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional(),
  acks: z.array(z.enum(["laser", "microblading"])).max(4).optional(), // casillas de seguridad marcadas
  website: z.string().optional(), // honeypot
  otp: z.string().regex(/^\d{6}$/).optional(),
  attr: z.object({ sid: z.string().max(40).optional(), utm_source: z.string().max(60).optional(), utm_medium: z.string().max(60).optional(), utm_campaign: z.string().max(60).optional(), ref: z.string().max(12).optional(), flow: z.string().max(8).optional() }).optional(),
});

/** Visita en horas distintas: confirma todas las citas de una vez (o ninguna). */
export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    if (b.website) throw new BookingError("INVALID", "No hemos podido procesar la solicitud.");
    await guardConfirm(req, b.phone, b.otp);
    const r = await confirmGroup({ legs: b.legs, name: b.name, phone: b.phone, email: b.email || null, notes: b.notes || null, acks: b.acks });
    if (r.checkoutUrl) return { bookings: r.bookings, checkoutUrl: r.checkoutUrl };
    if (r.fresh) {
      after(async () => {
        await recordConfirmed(r.bookings.map((x) => x.id), b.attr, r.bookings.map((x) => x.serviceName).join(" + "));
        await markLeadsBooked(r.bookings[0]?.customerPhone ?? null);
        await registerReferral(r.bookings[0]?.customerPhone ?? null, b.attr?.ref);
        await notifyGroupCreated(r.bookings);
        for (const x of r.bookings) await markWaitlistBooked(x.customerPhone, x.startsAt);
        if (r.noShowCount >= Number(process.env.NO_SHOW_ALERT ?? 2)) await notifyOwnerRepeatOffender(r.bookings[0], r.noShowCount);
      });
    }
    return { bookings: r.bookings };
  });
}
