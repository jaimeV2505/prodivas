import type { Metadata } from "next";
import Link from "next/link";
import BookingCards from "@/components/BookingCards";
import PendingPayment from "@/components/PendingPayment";
import StatusTag from "@/components/StatusTag";
import ResponseButtons from "@/components/ResponseButtons";
import { getBookingByCode, listCustomerBookings, RESCHEDULE_HOURS } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { fmtLong, fmtPrice } from "@/lib/format";
import { whenWords } from "@/lib/notify";
import { DEPOSIT_REFUND_HOURS } from "@/lib/payments";

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
              <ResponseButtons
                code={booking.code}
                token={t!}
                initial={booking.customerResponse === "CONFIRMED" ? "confirmed" : "pending"}
                warnDeposit={booking.depositStatus === "PAID" && hoursLeft < DEPOSIT_REFUND_HOURS ? `Si cancelas ahora no se devuelve la señal (${fmtPrice(booking.depositCents)}).` : undefined}
              />
              {hoursLeft >= RESCHEDULE_HOURS ? (
                <Link className="easy__btn easy__btn--soft" href={`/c/${booking.code}/cambiar?t=${t}`}>Cambiar la hora</Link>
              ) : (
                <p className="muted small">Para cambiar la hora a estas alturas, llámanos al {CONFIG.salon.phoneMobile}.</p>
              )}
            </>
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
