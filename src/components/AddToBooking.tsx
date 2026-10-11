"use client";

import { useEffect, useState } from "react";
import { fmtDuration, fmtPrice } from "@/lib/format";

type Svc = { id: number; name: string; durationMin: number; priceCents: number };

/**
 * «Añade algo a tu cita»: servicios que caben justo a continuación (los comprueba el servidor con el motor de huecos).
 * Si no cabe ninguno, no se muestra nada.
 */
export default function AddToBooking({ code, token }: { code: string; token: string }) {
  const [list, setList] = useState<Svc[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    fetch(`/api/bookings/${code}/extras?t=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((j: { services: Svc[] }) => !off && setList(j.services))
      .catch(() => !off && setList([]));
    return () => {
      off = true;
    };
  }, [code, token]);

  async function add(s: Svc) {
    if (busy) return;
    setBusy(s.id);
    setError(null);
    try {
      const r = await fetch(`/api/bookings/${code}/extras`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, serviceId: s.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? "No se ha podido añadir. Llámanos, por favor.");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Sin conexión. Inténtalo de nuevo.");
      setBusy(null);
    }
  }

  if (!list || list.length === 0) return null;
  return (
    <section className="addto" aria-label="Añadir a tu cita">
      <h2 className="addto__h">¿Aprovechas y añades algo?</h2>
      <p className="muted small">Cabe justo a continuación de tu cita. Se suma a lo que ya tienes reservado.</p>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <div className="addto__list">
        {list.map((s) => (
          <button key={s.id} type="button" className="addto__btn" onClick={() => void add(s)} disabled={busy !== null}>
            <strong>{busy === s.id ? "Añadiendo…" : `＋ ${s.name}`}</strong>
            <small>+{fmtDuration(s.durationMin)} · +{fmtPrice(s.priceCents)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
