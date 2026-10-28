import Link from "next/link";
import type { ReactNode } from "react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import { LEGAL } from "@/lib/legal";

/** Marco común de las páginas legales. */
export default function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  const pending = Object.values(LEGAL).some((v) => typeof v === "string" && v.startsWith("COMPLETAR"));
  return (
    <>
      <SiteHeader />
      <main className="container legal">
        {process.env.NODE_ENV !== "production" && pending && (
          <p className="legal__dev" role="note">
            Solo visible en desarrollo: completa los campos «COMPLETAR» de <code>src/lib/legal.ts</code> y pide a tu gestor que revise estos textos antes de publicar.
          </p>
        )}
        <h1 className="legal__title">{title}</h1>
        <p className="legal__updated">Última actualización: {LEGAL.actualizado}</p>
        <div className="legal__body">{children}</div>
        <p className="legal__nav">
          <Link href="/privacidad">Privacidad</Link> · <Link href="/aviso-legal">Aviso legal</Link> · <Link href="/cookies">Cookies</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
