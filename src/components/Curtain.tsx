"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Cortina rosa que cubre la pantalla al cambiar de página y se retira al llegar la nueva. */
export default function Curtain() {
  const pathname = usePathname();
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.leaving !== "1") return;
    root.dataset.leaving = "2"; // la cortina sale hacia arriba
    const t = window.setTimeout(() => {
      const c = el.current;
      if (c) c.style.transition = "none";
      delete root.dataset.leaving; // vuelve abajo sin animar
      requestAnimationFrame(() => requestAnimationFrame(() => c && (c.style.transition = "")));
    }, 520);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return (
    <div ref={el} className="curtain" aria-hidden="true">
      <span className="curtain__word">Pro Diva</span>
    </div>
  );
}
