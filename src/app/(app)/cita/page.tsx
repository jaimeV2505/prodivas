import EasyBooking from "@/components/EasyBooking";
import InstallCard from "@/components/InstallCard";
import { loadCatalog } from "@/lib/catalog";
import { CONFIG } from "@/lib/config";
import { isDay, todayIn } from "@/lib/dates";
import { DEPOSIT_REFUND_HOURS, stripeEnabled } from "@/lib/payments";

export const dynamic = "force-dynamic";

export default async function EasyPage({
  searchParams,
}: {
  searchParams: Promise<{ servicio?: string; dia?: string }>;
}) {
  const sp = await searchParams;
  const { services, depositPolicy } = await loadCatalog();
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONFIG.salon.address)}`;
  return (
    <main>
      <EasyBooking
        services={services}
        today={todayIn(CONFIG.tz)}
        address={CONFIG.salon.address}
        mapsUrl={mapsUrl}
        depositEnabled={stripeEnabled()}
        depositPolicy={depositPolicy}
        refundHours={DEPOSIT_REFUND_HOURS}
        initialSlug={sp.servicio}
        initialDay={sp.dia && isDay(sp.dia) ? sp.dia : undefined}
      />
      <InstallCard />
    </main>
  );
}
