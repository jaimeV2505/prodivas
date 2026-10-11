import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { fmtDayLabel } from "@/lib/format";
import { BookingError, hashIp } from "@/lib/bookings";
import { clientIp, respond } from "@/lib/http";
import { notifyOwnerWaitlistJoined } from "@/lib/notify";
import { isDay } from "@/lib/dates";
import { joinWaitlist } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const Body = z.object({
  serviceId: z.number().int().positive().optional(),
  serviceIds: z.array(z.number().int().positive()).min(1).max(6).optional(),
  day: z.string().refine(isDay).nullable().optional(),
  part: z.enum(["ANY", "MORNING", "AFTERNOON"]).default("ANY"),
  name: z.string().trim().min(2, "Escribe tu nombre").max(80),
  phone: z.string().trim().regex(/^[+\d][\d\s().-]{7,17}$/, "Escribe un teléfono válido"),
  email: z.string().trim().email("Revisa tu email").max(120).optional().or(z.literal("")),
  source: z.enum(["web", "app"]).default("web"),
  website: z.string().optional(), // honeypot
}).refine((b) => b.serviceId || b.serviceIds, "Falta el servicio");

export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    if (b.website) throw new BookingError("INVALID", "No hemos podido procesar la solicitud.");
    const r = await joinWaitlist({
      serviceIds: b.serviceIds ?? [b.serviceId!],
      day: b.day ?? null,
      part: b.part,
      name: b.name,
      phone: b.phone,
      email: b.email || null,
      source: b.source,
      ipHash: hashIp(clientIp(req)),
    });
    if (!r.already) {
      after(() =>
        notifyOwnerWaitlistJoined({
          name: b.name,
          phone: b.phone,
          serviceName: r.serviceName,
          dayLabel: b.day ? fmtDayLabel(b.day) : "cualquier día de las próximas dos semanas",
        }),
      );
    }
    return { ok: true, already: r.already };
  });
}
