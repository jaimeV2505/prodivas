import { after, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { BookingError, respondToBooking } from "@/lib/bookings";
import { query } from "@/lib/db";
import { fallbackByProviderId } from "@/lib/fallback";
import { enabled, logSend, sendWhatsAppText } from "@/lib/messaging";
import { notifyOwnerResponse, whenWords } from "@/lib/notify";
import { offerFreedSlot } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

// Verificación del webhook (Meta llama una vez al configurarlo)
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

type WaStatus = { id: string; status: string; errors?: { title?: string; code?: number }[] };
type Msg = {
  from: string;
  type: string;
  button?: { payload?: string };
  interactive?: { button_reply?: { id?: string } };
};

// Respuestas a los botones "Confirmar" / "Cancelar" del recordatorio
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: { messages?: Msg[]; statuses?: WaStatus[] } }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const values = (payload.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => (c.value ?? {}) as { messages?: Msg[]; statuses?: WaStatus[] }));
  const messages = values.flatMap((v) => v.messages ?? []);
  const statuses = values.flatMap((v) => v.statuses ?? []);
  after(async () => {
    // Estados de entrega: sent → delivered → read, o failed (→ SMS de respaldo al momento)
    for (const st of statuses) {
      const why = st.errors?.[0]?.title ?? "error de WhatsApp";
      await query(
        `UPDATE notification_log SET delivery_status = $2, delivery_updated_at = now(), detail = COALESCE($3, detail)
         WHERE provider_id = $1 AND NOT (delivery_status IN ('delivered','read') AND $2 = 'sent')`,
        [st.id, st.status, st.status === "failed" ? why : null],
      );
      if (st.status === "failed") await fallbackByProviderId(st.id, why);
    }
    for (const m of messages) {
      const id = m.button?.payload ?? m.interactive?.button_reply?.id ?? "";
      const match = /^([CX]):([A-Z0-9]{4,16})$/.exec(id);
      if (!match) continue;
      const action = match[1] === "C" ? "confirm" : "cancel";
      try {
        const r = await respondToBooking({ code: match[2], action, phone: m.from });
        if (r.changed && r.state !== "already_cancelled") {
          await notifyOwnerResponse(r.booking, r.state as "confirmed" | "cancelled");
          if (r.state === "cancelled") await offerFreedSlot(r.booking);
        }
        if (enabled.whatsapp()) {
          const text =
            r.state === "confirmed"
              ? `¡Perfecto! Te esperamos ${whenWords(r.booking.startsAt)}. Gracias por confirmar.`
              : "Cita cancelada. Gracias por avisar. Cuando quieras otra, pídela en nuestra web o llámanos.";
          await logSend(r.booking.id, "reply", "whatsapp", await sendWhatsAppText(m.from, text));
        }
      } catch (e) {
        if (!(e instanceof BookingError)) console.error("[whatsapp:webhook]", e);
      }
    }
  });
  return NextResponse.json({ ok: true });
}
