import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { derivedSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** Twilio avisa aquí de si un SMS se entregó. El secreto va en la URL (?s=). */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("s") !== derivedSecret("twilio-status", 24)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const form = await req.formData();
  const sid = String(form.get("MessageSid") ?? "");
  const status = String(form.get("MessageStatus") ?? "");
  if (sid && status) {
    await query(`UPDATE notification_log SET delivery_status = $2, delivery_updated_at = now() WHERE provider_id = $1`, [sid, status]);
  }
  return NextResponse.json({ ok: true });
}
