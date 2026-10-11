import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import OptoutButton from "@/components/OptoutButton";
import { pickLang } from "@/lib/i18n";
import { msgDict } from "@/lib/i18n/msg";
import { parseOptoutToken } from "@/lib/optout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Baja de mensajes", robots: { index: false, follow: false } };

export default async function OptoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [c, h] = await Promise.all([cookies(), headers()]);
  const M = msgDict(pickLang(null, c.get("pd_lang")?.value, h.get("accept-language")));
  const valid = parseOptoutToken(token) !== null;
  return (
    <main className="easy easy--narrow">
      <section className="easy__card">
        <h1 className="easy__h">{M.byeTitle}</h1>
        {valid ? (
          <>
            <p>{M.byeBody}</p>
            <OptoutButton token={token} label={M.byeButton} done={M.byeDone} error={M.byeError} />
          </>
        ) : (
          <p>{M.byeError}</p>
        )}
      </section>
    </main>
  );
}
