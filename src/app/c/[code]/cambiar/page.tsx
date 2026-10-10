import type { Metadata } from "next";
import Link from "next/link";
import ReschedulePicker from "@/components/ReschedulePicker";
import { getBookingByCode, RESCHEDULE_HOURS } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { todayIn } from "@/lib/dates";
import { fmtLong } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cambiar la hora", robots: { index: false, follow: false } };

export default async function ReschedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ code }, { t }] = await Promise.all([params, searchParams]);
  const b = t ? await getBookingByCode(code.toUpperCase(), t) : null;
  const hoursLeft = b ? (new Date(b.startsAt).getTime() - Date.now()) / 3600000 : 0;
  const tel = `tel:+34${CONFIG.salon.phoneMobile.replace(/\s/g, "")}`;

  if (!b || b.status !== "CONFIRMED" || hoursLeft < RESCHEDULE_HOURS) {
    return (
      <main className="easy easy--narrow">
        <Link href="/cita" className="easy__brand">Pro Diva</Link>
        <section className="easy__card">
          <h1 className="easy__h">No se puede cambiar online</h1>
          <p>{b && b.status === "CONFIRMED" ? `Faltan menos de ${RESCHEDULE_HOURS} horas. Llámanos al ${CONFIG.salon.phoneMobile} y lo arreglamos.` : "No encontramos esa cita."}</p>
          <a className="easy__btn easy__btn--main" href={tel}>Llamar al centro</a>
          {b && <Link className="easy__back" href={`/c/${b.code}?t=${t}`}>Volver a mi cita</Link>}
        </section>
      </main>
    );
  }

  return (
    <main className="easy">
      <Link className="easy__back" href={`/c/${b.code}?t=${t}`}>← Volver a mi cita</Link>
      <h1 className="easy__h">Cambiar la hora</h1>
      <p className="easy__sub">Ahora: {fmtLong(b.startsAt)} ({b.serviceName})</p>
      <ReschedulePicker code={b.code} token={t!} serviceIds={b.serviceIds} currentStartsAt={b.startsAt} today={todayIn(CONFIG.tz)} />
    </main>
  );
}
