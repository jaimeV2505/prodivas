import type { Metadata } from "next";
import BookingFlow, { type Service, type Staff } from "@/components/BookingFlow";
import SiteHeader from "@/components/SiteHeader";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";
import { DEPOSIT_REFUND_HOURS, stripeEnabled } from "@/lib/payments";
import { listTrends } from "@/lib/trends";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reservar cita" };

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: Promise<{ servicio?: string; dia?: string; hora?: string; color?: string; extra?: string }>;
}) {
  const sp = await searchParams;
  const [services, staff, trends] = await Promise.all([
    query<Service>(
      `SELECT id, slug, name, category, description, duration_min AS "durationMin", price_cents AS "priceCents", deposit_cents AS "depositCents"
       FROM services WHERE active ORDER BY sort, id`,
    ),
    query<Staff>(`SELECT id, name FROM staff WHERE active ORDER BY sort, id`),
    listTrends(),
  ]);
  const today = todayIn(CONFIG.tz);

  return (
    <>
      <SiteHeader />
      <main className="container flow-page">
        <h1 className="flow-title">Reserva tu cita</h1>
        <BookingFlow
          services={services}
          staff={staff}
          trends={trends}
          initialSlug={sp.servicio}
          initialExtras={sp.extra ? sp.extra.split(",").filter((x) => /^[a-z0-9-]{1,60}$/.test(x)).slice(0, 3) : undefined}
          initialDay={sp.dia && isDay(sp.dia) ? sp.dia : undefined}
          initialTime={sp.hora && /^\d{2}:\d{2}$/.test(sp.hora) ? sp.hora : undefined}
          initialColor={sp.color ? sp.color.replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 40) || undefined : undefined}
          today={today}
          maxDate={addDays(today, CONFIG.maxDaysAhead)}
          whatsapp={CONFIG.salon.whatsapp}
          address={CONFIG.salon.address}
          depositEnabled={stripeEnabled()}
          refundHours={DEPOSIT_REFUND_HOURS}
        />
      </main>
    </>
  );
}
