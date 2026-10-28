"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getConsent, setConsent } from "@/lib/track";

/** Aviso discreto y no bloqueante. Se pinta solo en el navegador (sin parpadeo del servidor) y nunca tapa la barra fija del móvil. */
export default function ConsentBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (getConsent() === null) {
      const t = window.setTimeout(() => setOpen(true), 900);
      return () => window.clearTimeout(t);
    }
  }, []);
  if (!open) return null;
  const pick = (v: "yes" | "no") => {
    setConsent(v);
    setOpen(false);
  };
  return (
    <aside className="consent" role="dialog" aria-live="polite" aria-label="Privacidad y medición anónima">
      <p className="consent__text">
        Medimos de forma <strong>anónima</strong> cómo se usa la reserva para mejorarla. Sin cookies de terceros y sin tu nombre ni teléfono.{" "}
        <Link href="/cookies">Más información</Link>
      </p>
      <div className="consent__btns">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => pick("yes")}>Aceptar</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => pick("no")}>Solo lo necesario</button>
      </div>
    </aside>
  );
}
