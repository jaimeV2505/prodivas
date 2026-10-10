"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Vuelve a cargar los datos de la página cada 30 s y al volver a la pestaña: las cancelaciones aparecen solas. */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && router.refresh();
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}
