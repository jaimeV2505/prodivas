"use client";

import { useEffect, useState } from "react";

/** Número de avisos sin leer junto a la pestaña «Avisos»; se actualiza solo y avisa en el título de la pestaña del navegador. */
export default function UnreadBadge({ initial }: { initial: number }) {
  const [n, setN] = useState(initial);
  useEffect(() => {
    let off = false;
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    const tick = async () => {
      try {
        const r = await fetch("/api/admin/avisos", { cache: "no-store" });
        if (!r.ok || off) return;
        const j = (await r.json()) as { unread: number };
        setN(j.unread);
        document.title = j.unread > 0 ? `(${j.unread}) ${base}` : base;
      } catch {
        /* sin conexión: se reintenta */
      }
    };
    void tick();
    const t = setInterval(tick, 20000);
    return () => {
      off = true;
      clearInterval(t);
      document.title = base;
    };
  }, []);
  if (!n) return null;
  return <span className="badge-n" aria-label={`${n} avisos sin leer`}>{n > 99 ? "99+" : n}</span>;
}
