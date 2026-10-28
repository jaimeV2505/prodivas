"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/track";

/** Primer paso del embudo: alguien llega a la web pública (el panel y los enlaces personales no cuentan). */
export default function PageTrack() {
  const path = usePathname() ?? "/";
  useEffect(() => {
    if (/^\/(admin|c\/|baja|reserva\/|hueco|api)/.test(path)) return;
    track("landing", { flow: path.startsWith("/cita") ? "easy" : path.startsWith("/reservar") ? "full" : "hero", meta: { path } });
  }, [path]);
  return null;
}
