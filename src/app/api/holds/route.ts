import type { NextRequest } from "next/server";
import { z } from "zod";
import { createHold, hashIp } from "@/lib/bookings";
import { clientIp, respond } from "@/lib/http";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    serviceId: z.number().int().positive().optional(),
    serviceIds: z.array(z.number().int().positive()).min(1).max(4).optional(),
    staffId: z.number().int().positive().nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    replaceHoldId: z.string().uuid().optional(),
    replaceToken: z.string().min(10).max(80).optional(),
    extend: z.array(z.object({ holdId: z.string().uuid(), holdToken: z.string().min(10).max(80) })).max(3).optional(),
  })
  .refine((b) => b.serviceId || b.serviceIds, "Falta el servicio");

export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    return createHold({
      serviceIds: b.serviceIds ?? [b.serviceId!],
      staffId: b.staffId ?? null,
      startsAt: b.startsAt,
      ipHash: hashIp(clientIp(req)),
      replace: b.replaceHoldId && b.replaceToken ? { holdId: b.replaceHoldId, holdToken: b.replaceToken } : undefined,
      extend: b.extend,
    });
  });
}
