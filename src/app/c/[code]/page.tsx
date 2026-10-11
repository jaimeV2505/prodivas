import type { Metadata } from "next";
import Link from "next/link";
import AddToBooking from "@/components/AddToBooking";
import BookingCards from "@/components/BookingCards";
import PendingPayment from "@/components/PendingPayment";
import StatusTag from "@/components/StatusTag";
import ResponseButtons from "@/components/ResponseButtons";
import { getBookingByCode, listCustomerBookings, RESCHEDULE_HOURS } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { getLoyalty, stampsOf } from "@/lib/loyalty";
import { fmtLong, fmtPrice } from "@/lib/format";
import { whenWords } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu cita", robots: { index: false, follow: false } };

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ t?: string; paid?: string }>;
}) {
  const [{ code }, { t, paid }] = await Promise.all([params, searchParams]);
  const booking = t ? await getBookingByCode(code.toUpperCase(), t) : null;
  const hoursLeft = booking ? (new Date(booking.startsAt).getTime() - Date.now()) / 3600000 : 0;
  const past = booking ? hoursLeft < 0 : false;
  const paying = booking?.status === "HOLD" && booking.depositStatus === "PENDING";
  // Otras citas de la misma clienta (varias a la vez), con las canceladas en rojo
  const others = booking?.customerId
    ? (await listCustomerBookings([booking.customerId])).filter((o) => o.id !== booking.id && (o.status === "CONFIRMED" || new Date(o.startsAt).getTime() > Date.now() - 7 * 86400000))
    : [];
  // Citas que quedan de su visita en horas distintas (para ofrecerle «cancelar todas»)
  const legsLeft = booking?.groupId ? 1 + others.filter((o) => o.groupId === booking.groupId && o.status === "CONFIRMED" && new Date(o.startsAt).getTime() > Date.now()).length : 1;
  // Tarjeta de sellos (si el programa está activo)
  const loyalty = booking?.customerId
    ? await (async () => {
        try {
          const l = await getLoyalty();
          if (!l.enabled) return null;
          const c = (await query<{ visit_count: number; loyalty_redeemed: number }>(`SELECT visit_count, loyalty_redeemed FROM customers WHERE id = $1::bigint`, [booking.customerId]))[0];
          return c ? { ...l, ...stampsOf(c.visit_count, c.loyalty_redeemed, l.every) } : null;
        } catch {
          return null; // migración pendiente: sin tarjeta
        }
      })()
    : null;
  const canAdd = !!booking && booking.status === "CONFIRMED" && !past && hoursLeft >= RESCHEDULE_HOURS && !booking.rescheduleFree;
  const tel = `tel:+34${CONFIG.salon.phoneMobile.replace(/\s/g, "")}`;

  return (
    <main className="easy easy--narrow">
      <Link href="/cita" className="easy__back easy__back--left">← Volver a mis citas</Link>
      {paying ? (
        <section className="easy__card">
          <PendingPayment />
          <h1 className="easy__h">{paid ? "Confirmando tu pago…" : "Falta pagar la señal"}</h1>
          <p>{paid ? "En unos segundos verás aquí tu cita confirmada." : "Tu hueco está guardado unos minutos. Termina el pago para confirmarlo."}</p>
        </section>
      ) : !booking || booking.status === "HOLD" || booking.status === "EXPIRED" ? (
        <section className="easy__card">
          <h1 className="easy__h">No encontramos tu cita</h1>
          <p>Revisa el enlace del mensaje o llámanos al {CONFIG.salon.phoneMobile}.</p>
          <a className="btn btn--ghost" href={tel}>Llamar al centro</a>
        </section>
      ) : (
        <section className="easy__card">
          <p><StatusTag status={booking.status} attendance={booking.attendance} startsAt={booking.startsAt} cancelReason={booking.cancelReason} /></p>
          <h1 className="easy__h">{booking.status === "CANCELLED" ? "Esta cita se canceló" : past ? "Esta cita ya pasó" : `¿Vienes ${whenWords(booking.startsAt)}?`}</h1>
          <p className="easy__when">{fmtLong(booking.startsAt)}</p>
          <p>{booking.serviceName}</p>
          {booking.depositStatus === "PAID" && <p className="muted">Señal pagada: {fmtPrice(booking.depositCents)}</p>}
          {booking.depositStatus === "REFUNDED" && <p className="muted">Te hemos devuelto la señal ({fmtPrice(booking.depositCents)}).</p>}
          {booking.status === "CONFIRMED" && !past && (
            <>
              {booking.rescheduleFree && (
                <div className="notice notice--info" role="status">
                  <strong>Tenemos que mover tu cita.</strong> Lo sentimos mucho.{booking.centreNote ? ` ${booking.centreNote}` : ""} Elige una hora nueva o cancela sin ningún coste.
                </div>
              )}
              <ResponseButtons
                code={booking.code}
                token={t!}
                initial={booking.customerResponse === "CONFIRMED" ? "confirmed" : "pending"}
                late={!booking.canCancel}
                noticeHours={booking.noticeHours}
                depositLoss={booking.depositStatus === "PAID" && hoursLeft < booking.refundHours ? booking.depositCents : 0}
                canMove={hoursLeft >= RESCHEDULE_HOURS || booking.rescheduleFree}
                closedByCentre={booking.rescheduleFree}
                legs={legsLeft}
              />
              {hoursLeft >= RESCHEDULE_HOURS || booking.rescheduleFree ? (
                <Link className="easy__btn easy__btn--soft" href={`/c/${booking.code}/cambiar?t=${t}`}>Cambiar la hora</Link>
              ) : (
                <p className="muted small">Para cambiar la hora a estas alturas, llámanos al {CONFIG.salon.phoneMobile}.</p>
              )}
            </>
          )}
          {canAdd && <AddToBooking code={booking.code} token={t!} />}
          {loyalty && (
            <div className="loyalty" role="note">
              <p className="loyalty__t">🎁 {loyalty.rewards > 0 ? `¡Tienes un premio: ${loyalty.reward}! Díselo a Pro Diva en tu próxima visita.` : `Tu tarjeta de sellos: ${loyalty.progress} de ${loyalty.every}`}</p>
              <div className="loyalty__dots" aria-hidden="true">
                {Array.from({ length: loyalty.every }).map((_, i) => (
                  <span key={i} className={`loyalty__dot ${i < loyalty.progress ? "is-on" : ""}`}>{i < loyalty.progress ? "★" : ""}</span>
                ))}
              </div>
              {loyalty.rewards === 0 && <p className="muted small">Cada visita suma un sello. Al completar la tarjeta: {loyalty.reward}.</p>}
            </div>
          )}
          <p className="muted small">{CONFIG.salon.address}</p>
          <a className="btn btn--ghost" href={tel}>Llamar al centro</a>
        </section>
      )}
      {others.length > 0 && (
        <section className="mine mine--easy" aria-label="Tus otras citas">
          <h2 className="mine__h">Tus otras citas</h2>
          <BookingCards variant="easy" items={others.map((o) => ({ code: o.code, token: o.token, status: o.status, attendance: o.attendance, startsAt: o.startsAt, serviceName: o.serviceName, cancelReason: o.cancelReason }))} />
        </section>
      )}
      <Link className="easy__btn easy__btn--soft" href="/cita">Pedir otra cita</Link>
    </main>
  );
}
