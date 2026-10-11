import type { Metadata } from "next";
import OptoutButton from "@/components/OptoutButton";
import { msg as M } from "@/lib/i18n/msg";
import { parseOptoutToken } from "@/lib/optout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Baja de mensajes", robots: { index: false, follow: false } };

export default async function OptoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
