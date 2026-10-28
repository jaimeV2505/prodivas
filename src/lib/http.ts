import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BookingError } from "./bookings";

export async function respond(fn: () => Promise<unknown>): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };
  try {
    return NextResponse.json(await fn(), { headers });
  } catch (e) {
    if (e instanceof BookingError) {
      return NextResponse.json({ error: { code: e.code, message: e.message, ...(e.data ? { data: e.data } : {}) } }, { status: e.status, headers });
    }
    if (e instanceof ZodError) {
      const message = e.issues[0]?.message ?? "Datos no válidos.";
      return NextResponse.json({ error: { code: "INVALID", message } }, { status: 400, headers });
    }
    console.error("[api]", e);
    return NextResponse.json(
      { error: { code: "SERVER", message: "Algo ha fallado por nuestra parte. Inténtalo de nuevo." } },
      { status: 500, headers },
    );
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
