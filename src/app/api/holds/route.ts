import type { NextRequest } from "next/server";
import { z } from "zod";
import { createHold, hashIp } from "@/lib/bookings";
import { clientIp, respond } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { MAX_SERVICES } from "@/lib/visit";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    serviceId: z.number().int().positive().optional(),
    serviceIds: z.array(z.number().int().positive()).min(1).max(MAX_SERVICES).optional(),
    addonIds: z.array(z.number().int().positive()).max(6).optional(),
    packageSlug: z.string().regex(/^[a-z0-9-]{1,60}$/).nullable().optional(),
    staffId: z.number().int().positive().nullable().optional(),
    preferStaffId: z.number().int().positive().optional(), // «como siempre»: se elige si está libre; si no, cualquiera
    startsAt: z.string().datetime({ offset: true }),
    replaceHoldId: z.string().uuid().optional(),
    replaceToken: z.string().min(10).max(80).optional(),
    extend: z.array(z.object({ holdId: z.string().uuid(), holdToken: z.string().min(10).max(80) })).max(3).optional(),
  })
  .refine((b) => b.serviceId || b.serviceIds, "Falta el servicio");

export async function POST(req: NextRequest) {
  return respond(async () => {
    const b = Body.parse(await req.json());
    const ip = hashIp(clientIp(req));
    await limit(`holds:${ip}`, 40, 600, "Demasiados intentos seguidos. Espera un par de minutos.");
    return createHold({
      serviceIds: b.serviceIds ?? [b.serviceId!],
      staffId: b.staffId ?? null,
      preferStaffId: b.preferStaffId ?? null,
      startsAt: b.startsAt,
      ipHash: ip,
      replace: b.replaceHoldId && b.replaceToken ? { holdId: b.replaceHoldId, holdToken: b.replaceToken } : undefined,
      extend: b.extend,
      addonIds: b.addonIds,
      packageSlug: b.packageSlug ?? null,
    });
  });
}
