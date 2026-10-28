"use client";

import { useEffect, useState } from "react";
import { getConsent, setConsent } from "@/lib/track";

/** Muestra y permite cambiar la elección de medición anónima. */
export default function CookieChoice() {
  const [v, setV] = useState<"yes" | "no" | null | undefined>(undefined);
  useEffect(() => setV(getConsent()), []);
  if (v === undefined) return null;
  const pick = (x: "yes" | "no") => {
    setConsent(x);
    setV(x);
  };
  return (
    <div className="legal__choice">
      <p>
        Elección actual: <strong>{v === "yes" ? "medición anónima aceptada" : v === "no" ? "solo lo necesario" : "sin elegir"}</strong>
      </p>
      <div className="legal__choice-btns">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => pick("yes")}>Aceptar medición anónima</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => pick("no")}>Solo lo necesario</button>
      </div>
    </div>
  );
}
