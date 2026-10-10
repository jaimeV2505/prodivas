"use client";

import { useEffect, useState, type ReactNode } from "react";
import { loadSaved } from "@/lib/myBookings";
import BookingCards, { type CardBooking } from "./BookingCards";

/**
 * «Tus citas»: varias citas a la vez, con las canceladas visibles (etiqueta roja).
 * Orden pensado para el pulgar: próximas citas (2 como máximo, el resto con «Ver todas»), luego las
 * acciones (`children`: pedir cita, repetir…) y debajo las canceladas.
 */
export default function MyBookings({ variant = "web", children }: { variant?: "web" | "easy"; children?: ReactNode }) {
  const [items, setItems] = useState<CardBooking[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const saved = loadSaved();
    if (!saved.length) {
      setItems([]);
      return;
    }
    let off = false;
    fetch("/api/my-bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: saved }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((j: { bookings: CardBooking[] }) => !off && setItems(j.bookings))
      .catch(() => !off && setItems([]));
    return () => {
      off = true;
    };
  }, []);

  const now = Date.now();
  const upcoming = (items ?? []).filter((b) => b.status === "CONFIRMED" && new Date(b.startsAt).getTime() >= now - 2 * 3600000);
  const cancelled = (items ?? []).filter((b) => b.status === "CANCELLED" && new Date(b.startsAt).getTime() > now - 7 * 86400000).slice(-4);
  const shown = all ? upcoming : upcoming.slice(0, 2);

  return (
    <>
      {upcoming.length > 0 && (
        <section className={`mine mine--${variant}`} aria-label="Tus próximas citas">
          <h2 className="mine__h">{upcoming.length > 1 ? "Tus próximas citas" : "Tu próxima cita"}</h2>
          <BookingCards items={shown} variant={variant} />
          {upcoming.length > 2 && (
            <button type="button" className={variant === "easy" ? "easy__btn easy__btn--soft" : "btn btn--ghost btn--block"} onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? "Ver menos" : `Ver las ${upcoming.length} citas`}
            </button>
          )}
        </section>
      )}
      {children}
      {cancelled.length > 0 && (
        <section className={`mine mine--${variant}`} aria-label="Citas canceladas">
          <h2 className="mine__h mine__h--sub">Canceladas</h2>
          <BookingCards items={cancelled} variant={variant} />
        </section>
      )}
    </>
  );
}
