import type { Metadata } from "next";
import Link from "next/link";
import CancelButton from "@/components/CancelButton";
import SiteHeader from "@/components/SiteHeader";
import { getBookingByCode } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { fmtLong, fmtPrice } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mi cita", robots: { index: false, follow: false } };

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ code }, { t }] = await Promise.all([params, searchParams]);
  const booking = t ? await getBookingByCode(code.toUpperCase(), t) : null;

  return (
    <>
      <SiteHeader />
      <main className="container narrow">
        {!booking || booking.status === "HOLD" || booking.status === "EXPIRED" ? (
          <section className="panel">
            <h1 className="panel__title">No encontramos esa cita</h1>
            <p className="muted">Revisa el enlace que te dimos al reservar. Si lo perdiste, llámanos al {CONFIG.salon.phoneMobile}.</p>
            <Link className="btn btn--primary" href="/reservar">Reservar una cita</Link>
          </section>
        ) : (
          <section className="panel">
            <h1 className="panel__title">{booking.status === "CANCELLED" ? "Cita cancelada" : "Tu cita"}</h1>
            <dl className="details">
              <dt>Cuándo</dt>
              <dd>{fmtLong(booking.startsAt)}</dd>
              <dt>Servicio</dt>
              <dd>{booking.serviceName} · {fmtPrice(booking.priceCents)}</dd>
              <dt>Dónde</dt>
              <dd>{CONFIG.salon.address}</dd>
              <dt>Código</dt>
              <dd>{booking.code}</dd>
            </dl>
            {booking.status === "CONFIRMED" && booking.canCancel && <CancelButton code={booking.code} token={booking.token} />}
            {booking.status === "CONFIRMED" && !booking.canCancel && (
              <p className="muted">
                Faltan menos de {CONFIG.cancelNoticeHours} horas: para cambiar o cancelar llámanos al {CONFIG.salon.phoneMobile}.
              </p>
            )}
            {booking.status === "CANCELLED" && (
              <Link className="btn btn--primary" href="/reservar">Reservar otra cita</Link>
            )}
          </section>
        )}
      </main>
    </>
  );
}
