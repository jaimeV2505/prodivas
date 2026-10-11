import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { addableServices, addServiceToBooking } from "@/lib/bookings";
import { respond } from "@/lib/http";
import { notifyRescheduled } from "@/lib/notify";

export const dynamic = "force-dynamic";

const code = (v: string) => z.string().min(4).max(16).parse(v).toUpperCase();

/** Servicios que se pueden añadir a una cita ya reservada (los que caben justo a continuación). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code: c } = await ctx.params;
    const t = z.string().min(12).max(80).parse(req.nextUrl.searchParams.get("t"));
    return { services: await addableServices(code(c), t) };
  });
}

/** Añade un servicio a la cita. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code: c } = await ctx.params;
    const b = z.object({ token: z.string().min(12), serviceId: z.number().int().positive() }).parse(await req.json());
    const r = await addServiceToBooking({ code: code(c), token: b.token, serviceId: b.serviceId });
    after(() => notifyRescheduled(r.booking, r.old.startsAt, true, `➕ <b>${r.booking.customerName ?? ""}</b> añade ${r.added} a su cita (${r.booking.serviceName}). Ahora termina a las ${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: process.env.SALON_TIMEZONE || "Europe/Madrid" }).format(new Date(r.booking.endsAt))}.`));
    return { booking: r.booking };
  });
}
