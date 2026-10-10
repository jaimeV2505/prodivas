import EasyBooking from "@/components/EasyBooking";
import type { Service } from "@/components/BookingFlow";
import InstallCard from "@/components/InstallCard";
import { CONFIG } from "@/lib/config";
import { isDay, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";
import { DEPOSIT_REFUND_HOURS, stripeEnabled } from "@/lib/payments";

export const dynamic = "force-dynamic";

export default async function EasyPage({
  searchParams,
}: {
  searchParams: Promise<{ servicio?: string; dia?: string }>;
}) {
  const sp = await searchParams;
  const services = await query<Service>(
    `SELECT id, slug, name, category, description, duration_min AS "durationMin", price_cents AS "priceCents", deposit_cents AS "depositCents"
     FROM services WHERE active ORDER BY sort, id`,
  );
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONFIG.salon.address)}`;
  return (
    <main>
      <EasyBooking
        services={services}
        today={todayIn(CONFIG.tz)}
        address={CONFIG.salon.address}
        mapsUrl={mapsUrl}
        depositEnabled={stripeEnabled()}
        refundHours={DEPOSIT_REFUND_HOURS}
        initialSlug={sp.servicio}
        initialDay={sp.dia && isDay(sp.dia) ? sp.dia : undefined}
      />
      <InstallCard />
    </main>
  );
}
