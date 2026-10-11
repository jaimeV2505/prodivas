import EasyBooking from "@/components/EasyBooking";
import InstallBanner from "@/components/InstallBanner";
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
  const { services, packs, depositPolicy } = await loadCatalog();
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONFIG.salon.address)}`;
  return (
    <main>
      {/* Arriba y siempre que se entra: instalar la app para tener solo el módulo de pedir cita en el móvil */}
      <InstallBanner />
      <EasyBooking
        services={services}
        packs={packs}
        today={todayIn(CONFIG.tz)}
        address={CONFIG.salon.address}
        mapsUrl={mapsUrl}
        depositEnabled={stripeEnabled()}
        depositPolicy={depositPolicy}
        refundHours={DEPOSIT_REFUND_HOURS}
        initialSlug={sp.servicio}
        initialDay={sp.dia && isDay(sp.dia) ? sp.dia : undefined}
      />
    </main>
  );
}
