import type { NextRequest } from "next/server";
import { z } from "zod";
import { createHold, hashIp } from "@/lib/bookings";
import { clientIp, respond } from "@/lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  serviceId: z.number().int().positive(),
  staffId: z.number().int().positive().nullable().optional(),
  startsAt: z.string().datetime({ offset: true }),
});

export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    return createHold({
      serviceId: b.serviceId,
      staffId: b.staffId ?? null,
      startsAt: b.startsAt,
      ipHash: hashIp(clientIp(req)),
    });
  });
}
