import type { NextRequest } from "next/server";
import { z } from "zod";
import { getBookingByCode, listCustomerBookings } from "@/lib/bookings";
import { hashIp } from "@/lib/bookings";
import { clientIp, respond } from "@/lib/http";
import { limit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const Body = z.object({
  items: z.array(z.object({ code: z.string().min(4).max(16), token: z.string().min(12).max(80) })).max(20),
});

/**
 * «Tus citas»: el móvil manda los enlaces (código + token) de las citas que ha reservado en él y recibe
 * el estado actual de todas, incluidas otras citas de la misma clienta y las canceladas (con su etiqueta).
 */
export async function POST(req: NextRequest) {
  return respond(async () => {
    await limit(`mybk:${hashIp(clientIp(req))}`, 40, 600);
    const { items } = Body.parse(await req.json());
    const known = (await Promise.all(items.map((i) => getBookingByCode(i.code.toUpperCase(), i.token)))).filter((b) => !!b);
    const customerIds = Array.from(new Set(known.map((b) => b!.customerId).filter((id): id is number => id !== null)));
    const all = await listCustomerBookings(customerIds);
    // las que no tienen ficha (citas antiguas) también se devuelven
    const seen = new Set(all.map((b) => b.id));
    for (const b of known) if (b && !seen.has(b.id)) all.push(b);
    all.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return {
      bookings: all.map((b) => ({
        code: b.code,
        token: b.token,
        status: b.status,
        attendance: b.attendance,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        serviceName: b.serviceName,
        priceCents: b.priceCents,
        cancelReason: b.cancelReason,
      })),
    };
  });
}
