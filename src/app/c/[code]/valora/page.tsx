import type { Metadata } from "next";
import Link from "next/link";
import ReviewForm from "@/components/ReviewForm";
import { getBookingByCode } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { fmtLong } from "@/lib/format";
import { fill, LOCALE, pickLang, localized } from "@/lib/i18n";
import { msgDict } from "@/lib/i18n/msg";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Valorar mi visita", robots: { index: false, follow: false } };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ code }, { t }] = await Promise.all([params, searchParams]);
  const b = t ? await getBookingByCode(code.toUpperCase(), t) : null;
  const lang = pickLang(b?.lang, null, null);
  const M = msgDict(lang);
  if (!b || b.status !== "CONFIRMED" || new Date(b.startsAt).getTime() > Date.now()) {
    return (
      <main className="easy easy--narrow">
        <section className="easy__card">
          <h1 className="easy__h">{M.revError}</h1>
          <p>{CONFIG.salon.phoneMobile}</p>
          <Link className="easy__btn easy__btn--soft" href="/cita">{CONFIG.salon.name}</Link>
        </section>
      </main>
    );
  }
  const already = (await query<{ id: number }>(`SELECT id FROM reviews WHERE booking_id = $1::uuid`, [b.id])).length > 0;
  return (
    <main className="easy easy--narrow">
      <section className="easy__card">
        <h1 className="easy__h">{M.revTitle}</h1>
        <p>{fill(M.revSub, { service: b.serviceName, when: fmtLong(b.startsAt, LOCALE[lang]) })}</p>
        <ReviewForm code={b.code} token={t!} t={M} googleUrl={process.env.GOOGLE_REVIEW_URL || null} alreadyRated={already} />
      </section>
    </main>
  );
}
