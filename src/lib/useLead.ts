"use client";

import { useEffect, useRef } from "react";
import { attribution, track } from "./track";

const PHONE_OK = /^[+\d][\d\s().-]{7,17}$/;

/**
 * Cuando ya hay un hueco bloqueado y la clienta escribe un teléfono válido, se guarda el contacto para poder
 * retomar la reserva si no la termina (se le escribe una sola vez). No espera a que acabe: solo usa lo que ya escribió.
 */
export function useLeadCapture(opts: { holdId?: string; holdToken?: string; phone: string; name: string; flow: "full" | "easy" }) {
  const sent = useRef("");
  const { holdId, holdToken, phone, name, flow } = opts;
  useEffect(() => {
    const p = phone.trim();
    if (!holdId || !holdToken || !PHONE_OK.test(p)) return;
    const key = `${holdId}|${p.replace(/\D/g, "")}`;
    if (sent.current === key) return;
    const t = setTimeout(() => {
      sent.current = key;
      const a = attribution();
      void fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdId, holdToken, name: name.trim() || undefined, phone: p, sid: a.sid, flow, utm_source: a.utm_source }),
      }).catch(() => {});
      track("lead", { flow });
    }, 1200);
    return () => clearTimeout(t);
  }, [holdId, holdToken, phone, name, flow]);
}
