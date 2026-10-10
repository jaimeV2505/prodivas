import { after, type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { finalizePaidBooking, listGroupIds, type BookingSummary } from "@/lib/bookings";
import { query } from "@/lib/db";
import { notifyBookingCreated, notifyGroupCreated, notifyOwnerRaw, notifyOwnerRepeatOffender } from "@/lib/notify";
import { refundPaymentIntent, verifyStripeSignature } from "@/lib/payments";
import { markWaitlistBooked } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

type StripeEvent = {
  type: string;
  data: { object: { id?: string; client_reference_id?: string; metadata?: { booking_id?: string; group_id?: string }; payment_intent?: string | null; payment_status?: string } };
};

/** Webhook de Stripe: confirma la cita cuando la señal está pagada (y libera el hueco si la sesión caduca). */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"))) {
    return new NextResponse("invalid signature", { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ received: true });
  }
  const obj = event.data?.object;
  const bookingId = obj?.metadata?.booking_id ?? obj?.client_reference_id;
  const groupId = obj?.metadata?.group_id;

  // Visita en horas distintas: una señal para varias citas
  if (groupId && event.type === "checkout.session.completed" && obj.payment_status === "paid") {
    const confirmed: BookingSummary[] = [];
    const lost: { id: string; cents: number }[] = [];
    let noShows = 0;
    for (const id of await listGroupIds(groupId)) {
      const r = await finalizePaidBooking(id, obj.payment_intent ?? null);
      if (r.state === "confirmed" && r.booking) {
        confirmed.push(r.booking);
        noShows = Math.max(noShows, r.noShowCount ?? 0);
      } else if (r.state === "conflict") {
        const row = await query<{ deposit_cents: number }>(`SELECT deposit_cents FROM bookings WHERE id = $1::uuid`, [id]);
        lost.push({ id, cents: row[0]?.deposit_cents ?? 0 });
      }
    }
    after(async () => {
      if (confirmed.length) {
        await notifyGroupCreated(confirmed);
        for (const b of confirmed) await markWaitlistBooked(b.customerPhone, b.startsAt);
        if (noShows >= Number(process.env.NO_SHOW_ALERT ?? 2)) await notifyOwnerRepeatOffender(confirmed[0], noShows);
      }
      // Pagó, pero alguna hora ya no estaba libre: se le devuelve la parte de esa cita y se avisa
      for (const l of lost) {
        if (obj.payment_intent && l.cents > 0) await refundPaymentIntent(obj.payment_intent, l.cents);
        await query(`UPDATE bookings SET deposit_status = 'REFUNDED', status = CASE WHEN status = 'HOLD' THEN 'EXPIRED' ELSE status END WHERE id = $1::uuid`, [l.id]);
        await notifyOwnerRaw(
          `⚠️ Una clienta pagó la señal de una visita en varias horas, pero una de ellas se ocupó antes. Se le ha devuelto la parte de esa cita (reserva ${l.id.slice(0, 8)}). Llámala para darle otra hora.`,
          "Señal devuelta: hueco ocupado",
          l.id,
        );
      }
    });
    return NextResponse.json({ received: true });
  }
  if (groupId && event.type === "checkout.session.expired") {
    await query(`UPDATE bookings SET status = 'EXPIRED', deposit_status = 'NONE' WHERE group_id = $1::uuid AND status = 'HOLD'`, [groupId]);
    return NextResponse.json({ received: true });
  }

  if (event.type === "checkout.session.completed" && bookingId && obj.payment_status === "paid") {
    const r = await finalizePaidBooking(bookingId, obj.payment_intent ?? null);
    if (r.state === "confirmed" && r.booking) {
      const b = r.booking;
      after(async () => {
        await notifyBookingCreated(b);
        await markWaitlistBooked(b.customerPhone, b.startsAt);
        if ((r.noShowCount ?? 0) >= Number(process.env.NO_SHOW_ALERT ?? 2)) await notifyOwnerRepeatOffender(b, r.noShowCount ?? 0);
      });
    } else if (r.state === "conflict") {
      // Pagó, pero el hueco ya no estaba libre: se le devuelve el dinero y se avisa
      after(async () => {
        if (obj.payment_intent) await refundPaymentIntent(obj.payment_intent);
        await query(`UPDATE bookings SET deposit_status = 'REFUNDED', status = CASE WHEN status = 'HOLD' THEN 'EXPIRED' ELSE status END WHERE id = $1::uuid`, [bookingId]);
        await notifyOwnerRaw(
          `⚠️ Una clienta pagó la señal pero su hueco se ocupó antes. Se le ha devuelto el dinero (reserva ${bookingId.slice(0, 8)}). Llámala para darle otra hora.`,
          "Señal devuelta: hueco ocupado",
          bookingId,
        );
      });
    }
  } else if (event.type === "checkout.session.expired" && bookingId) {
    await query(
      `UPDATE bookings SET status = 'EXPIRED', deposit_status = 'NONE' WHERE id = $1::uuid AND status = 'HOLD' AND deposit_status = 'PENDING'`,
      [bookingId],
    );
  }
  return NextResponse.json({ received: true });
}
