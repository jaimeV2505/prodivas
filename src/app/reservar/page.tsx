import type { Metadata } from "next";
import BookingFlow, { type Staff } from "@/components/BookingFlow";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { loadCatalog } from "@/lib/catalog";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";
import { getDict } from "@/lib/i18n";
import { DEPOSIT_REFUND_HOURS, stripeEnabled } from "@/lib/payments";
import { listTrends } from "@/lib/trends";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reservar cita" };

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: Promise<{ servicio?: string; dia?: string; hora?: string; color?: string; extra?: string; pro?: string }>;
}) {
  const sp = await searchParams;
  const T = getDict();
  const [catalog, staff, trends] = await Promise.all([
    loadCatalog(),
    query<Staff>(`SELECT id, name FROM staff WHERE active ORDER BY sort, id`),
    listTrends(),
  ]);
  const today = todayIn(CONFIG.tz);

  return (
    <>
      <SiteHeader />
      <main className="container flow-page">
        <div className="flow-head">
          <h1 className="flow-title">{T.pageTitle}</h1>
        </div>
        <BookingFlow
          services={catalog.services}
          staff={staff}
          addons={catalog.addons}
          packs={catalog.packs}
          depositPolicy={catalog.depositPolicy}
          trends={trends}
          initialSlug={sp.servicio}
          initialExtras={sp.extra ? sp.extra.split(",").filter((x) => /^[a-z0-9-]{1,60}$/.test(x)).slice(0, 5) : undefined}
          initialDay={sp.dia && isDay(sp.dia) ? sp.dia : undefined}
          initialTime={sp.hora && /^\d{2}:\d{2}$/.test(sp.hora) ? sp.hora : undefined}
          initialStaffId={sp.pro && /^\d{1,6}$/.test(sp.pro) ? Number(sp.pro) : undefined}
          initialColor={sp.color ? sp.color.replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 40) || undefined : undefined}
          today={today}
          maxDate={addDays(today, CONFIG.maxDaysAhead)}
          whatsapp={CONFIG.salon.whatsapp}
          address={CONFIG.salon.address}
          depositEnabled={stripeEnabled()}
          refundHours={DEPOSIT_REFUND_HOURS}
        />
      </main>
      <SiteFooter />
    </>
  );
}
