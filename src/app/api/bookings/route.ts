import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { BookingError, confirmBooking } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyBooking } from "@/lib/notify";

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
  website: z.string().optional(), // honeypot: las personas no lo ven ni lo rellenan
});

export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    if (b.website) throw new BookingError("INVALID", "No hemos podido procesar la solicitud.");
    const booking = await confirmBooking({
      holdId: b.holdId,
      holdToken: b.holdToken,
      name: b.name,
      phone: b.phone,
      email: b.email || null,
      notes: b.notes || null,
    });
    after(() => notifyBooking(booking, "created"));
    return { booking };
  });
}
