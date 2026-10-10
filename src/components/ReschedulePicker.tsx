"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { addDays } from "@/lib/dates";
import { fmtDayLabel, fmtLong } from "@/lib/format";

type Slot = { day: string; time: string; startsAt: string; available: boolean };

/** Elegir otro día y hora para una cita ya reservada (su propio hueco cuenta como libre). */
export default function ReschedulePicker({
  code,
  token,
  serviceIds,
  currentStartsAt,
  today,
}: {
  code: string;
  token: string;
  serviceIds: number[];
  currentStartsAt: string;
  today: string;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const qs = new URLSearchParams({ serviceIds: serviceIds.join(","), from: today, to: addDays(today, 20), exclude: code, t: token });
    try {
      const r = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setSlots(((await r.json()) as { slots: Slot[] }).slots);
    } catch {
      setError("No hemos podido ver los huecos. Revisa tu internet o llámanos.");
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(() => Array.from(new Set((slots ?? []).filter((s) => s.available).map((s) => s.day))).sort(), [slots]);
  const times = (slots ?? []).filter((s) => s.day === day && s.available);
  const label = (d: string) => (d === today ? "Hoy" : d === addDays(today, 1) ? "Mañana" : fmtDayLabel(d));

  async function confirm() {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/bookings/${code}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, startsAt: pick.startsAt }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? "No se pudo cambiar la hora.");
        setPick(null);
        await load();
        return;
      }
      setDone(j.booking.startsAt as string);
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="easy__done">
        <span className="easy__tick"><Check size={56} aria-hidden="true" /></span>
        <h2 className="easy__h">¡Hora cambiada!</h2>
        <p className="easy__when">{fmtLong(done)}</p>
        <p className="easy__sub">Te recordaremos ese día para que confirmes.</p>
        <Link className="easy__btn easy__btn--main" href={`/c/${code}?t=${token}`}>Ver mi cita</Link>
        <Link className="easy__back" href="/cita">← Volver a mis citas</Link>
      </section>
    );
  }

  return (
    <>
      {error && <p className="notice notice--error easy__notice" role="alert">{error}</p>}
      {slots === null && !error && <p className="easy__sub">Buscando huecos…</p>}
      {slots !== null && days.length === 0 && <p className="easy__sub">No quedan huecos en los próximos días. Llámanos y lo miramos juntas.</p>}
      {days.length > 0 && (
        <>
          <h2 className="easy__group">¿Qué día te viene bien?</h2>
          <div className="easy__list">
            {days.slice(0, 8).map((d) => (
              <button key={d} type="button" className={`easy__btn easy__btn--tile ${day === d ? "is-on" : ""}`} onClick={() => { setDay(d); setPick(null); }}>
                {label(d)}
              </button>
            ))}
          </div>
        </>
      )}
      {day && (
        <>
          <h2 className="easy__group">¿A qué hora?</h2>
          <div className="easy__times">
            {times.map((s) => (
              <button
                key={s.startsAt}
                type="button"
                className={`easy__btn easy__btn--time ${pick?.startsAt === s.startsAt ? "is-on" : ""}`}
                onClick={() => setPick(s)}
                aria-pressed={pick?.startsAt === s.startsAt}
              >
                {s.time}{s.startsAt === currentStartsAt ? " (actual)" : ""}
              </button>
            ))}
          </div>
        </>
      )}
      {pick && (
        <button type="button" className="easy__btn easy__btn--main" onClick={confirm} disabled={busy || pick.startsAt === currentStartsAt}>
          {busy ? "Cambiando…" : pick.startsAt === currentStartsAt ? "Esa es tu hora actual" : `Cambiar a ${fmtLong(pick.startsAt)}`}
        </button>
      )}
    </>
  );
}
