"use client";

import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { addDays } from "@/lib/dates";
import { fill, getDict, LOCALE, localized, type Lang } from "@/lib/i18n";
import { fmtLong, localParts } from "@/lib/format";
import { saveBooking, saveVisitHistory } from "@/lib/myBookings";
import type { Service } from "./BookingFlow";

type Slot = { day: string; time: string; startsAt: string; available: boolean };
type Props = {
  lang: Lang;
  today: string;
  maxDate: string;
  /** Hora de la cita que se acaba de reservar: el retoque se busca a las mismas horas, N semanas después. */
  baseStartsAt: string;
  /** Servicios de esta visita que llevan retoque. */
  services: Service[];
  contact: { name: string; phone: string; email: string };
  acks: string[];
};

const MIN = 60000;
const dayDiff = (a: string, b: string) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000);

/**
 * «¿Reservamos ya tu retoque?»: tras confirmar un servicio que lleva retoque (semipermanente, lifting…),
 * propone el mismo día de la semana y hora N semanas después y lo reserva con un toque.
 * Si ese hueco no está libre, ofrece los más cercanos. El cálculo usa el día y la hora LOCALES, así que
 * no se descuadra con el cambio de hora.
 */
export default function RebookCard({ lang, today, maxDate, baseStartsAt, services, contact, acks }: Props) {
  const T = getDict(lang);
  const locale = LOCALE[lang];
  const weeks = Math.min(...services.map((s) => s.rebookWeeks ?? 99));
  const picked = services.filter((s) => s.rebookWeeks === weeks);
  const base = localParts(baseStartsAt);
  const targetDay = addDays(base.day, weeks * 7);
  const ids = picked.map((s) => s.id).join(",");

  const [options, setOptions] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!picked.length || targetDay > maxDate) {
      setOptions([]);
      return;
    }
    let off = false;
    const from = addDays(targetDay, -3) < today ? today : addDays(targetDay, -3);
    const to = addDays(targetDay, 3) > maxDate ? maxDate : addDays(targetDay, 3);
    fetch(`/api/availability?serviceIds=${ids}&from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((j: { slots: Slot[] }) => {
        if (off) return;
        const dist = (s: Slot) => {
          const p = localParts(s.startsAt);
          return Math.abs(dayDiff(p.day, targetDay) * 1440 + (p.minutes - base.minutes));
        };
        setOptions(j.slots.filter((s) => s.available).sort((a, b) => dist(a) - dist(b)).slice(0, 3));
      })
      .catch(() => !off && setOptions([]));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, targetDay]);

  async function book(slot: Slot) {
    if (busy) return;
    setBusy(slot.startsAt);
    setError(null);
    try {
      const h = await fetch("/api/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds: picked.map((s) => s.id), staffId: null, startsAt: slot.startsAt }),
      });
      const hj = await h.json();
      if (!h.ok) throw new Error("hold");
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdId: hj.holdId, holdToken: hj.holdToken, name: contact.name, phone: contact.phone, email: contact.email, notes: "Retoque", acks }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error("confirm");
      if (j.checkoutUrl) {
        window.location.assign(j.checkoutUrl as string);
        return;
      }
      saveBooking(j.booking.code, j.booking.token);
      saveVisitHistory({ startsAt: j.booking.startsAt, slugs: picked.map((s) => s.slug) });
      setDoneAt(slot.startsAt);
    } catch {
      setError(T.rebookFail);
    } finally {
      setBusy(null);
    }
  }

  if (!picked.length || options === null) return null;
  if (doneAt) {
    return (
      <div className="rebook rebook--ok" role="status">
        <CalendarCheck size={20} aria-hidden="true" /> <p>{fill(T.rebookDone, { when: fmtLong(doneAt, locale) })}</p>
      </div>
    );
  }
  if (!options.length) return null;
  const names = picked.map((s) => localized(s, lang).name).join(" + ");
  const exact = (s: Slot) => {
    const p = localParts(s.startsAt);
    return p.day === targetDay && p.minutes === base.minutes;
  };
  return (
    <section className="rebook" aria-label={T.rebookTitle}>
      <h3>{T.rebookTitle}</h3>
      <p className="muted small">{fill(T.rebookSub, { weeks, names })}</p>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <div className="rebook__opts">
        {options.map((s) => (
          <button key={s.startsAt} type="button" className={`rebook__opt ${exact(s) ? "is-exact" : ""}`} onClick={() => void book(s)} disabled={!!busy}>
            <small>{exact(s) ? T.rebookSame : T.rebookNear}</small>
            <strong>{busy === s.startsAt ? T.rebookWorking : fmtLong(s.startsAt, locale)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
