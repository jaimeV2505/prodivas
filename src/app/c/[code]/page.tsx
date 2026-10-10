import type { Metadata } from "next";
import Link from "next/link";
import ResponseButtons from "@/components/ResponseButtons";
import { getBookingByCode } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { fmtLong } from "@/lib/format";
import { whenWords } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu cita", robots: { index: false, follow: false } };

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ code }, { t }] = await Promise.all([params, searchParams]);
  const booking = t ? await getBookingByCode(code.toUpperCase(), t) : null;
  const past = booking ? new Date(booking.startsAt).getTime() < Date.now() : false;

  return (
    <main className="easy easy--narrow">
      <Link href="/cita" className="easy__brand">Pro Diva</Link>
      {!booking || booking.status === "HOLD" || booking.status === "EXPIRED" ? (
        <section className="easy__card">
          <h1 className="easy__h">No encontramos tu cita</h1>
          <p>Revisa el enlace del mensaje o llámanos al {CONFIG.salon.phoneMobile}.</p>
        </section>
      ) : (
        <section className="easy__card">
          <h1 className="easy__h">{booking.status === "CANCELLED" ? "Cita cancelada" : past ? "Esta cita ya pasó" : `¿Vienes ${whenWords(booking.startsAt)}?`}</h1>
          <p className="easy__when">{fmtLong(booking.startsAt)}</p>
          <p>{booking.serviceName}</p>
          {booking.status === "CONFIRMED" && !past && (
            <ResponseButtons
              code={booking.code}
              token={t!}
              initial={booking.customerResponse === "CONFIRMED" ? "confirmed" : "pending"}
            />
          )}
          <p className="muted small">{CONFIG.salon.address}</p>
          <a className="btn btn--ghost" href={`tel:+34${CONFIG.salon.phoneMobile.replace(/\s/g, "")}`}>Llamar al centro</a>
        </section>
      )}
    </main>
  );
}
