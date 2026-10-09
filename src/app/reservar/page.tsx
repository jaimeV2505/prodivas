import type { Metadata } from "next";
import BookingFlow, { type Service, type Staff } from "@/components/BookingFlow";
import SiteHeader from "@/components/SiteHeader";
import { CONFIG } from "@/lib/config";
import { addDays, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reservar cita" };

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: Promise<{ servicio?: string }>;
}) {
  const sp = await searchParams;
  const [services, staff] = await Promise.all([
    query<Service>(
      `SELECT id, slug, name, category, description, duration_min AS "durationMin", price_cents AS "priceCents"
       FROM services WHERE active ORDER BY sort, id`,
    ),
    query<Staff>(`SELECT id, name FROM staff WHERE active ORDER BY sort, id`),
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
          initialSlug={sp.servicio}
          today={today}
          maxDate={addDays(today, CONFIG.maxDaysAhead)}
          whatsapp={CONFIG.salon.whatsapp}
          address={CONFIG.salon.address}
        />
      </main>
    </>
  );
}
