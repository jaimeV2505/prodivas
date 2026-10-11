"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays } from "@/lib/dates";
import { fmtPrice } from "@/lib/format";
import TransitionLink from "./TransitionLink";

export type HeroService = { id: number; slug: string; name: string; durationMin: number; priceCents: number };
type Slot = { day: string; time: string; startsAt: string; available: boolean };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mini-asistente del hero: servicio → próximos huecos reales → reservar con un toque. */
export default function HeroBooker({ services, today }: { services: HeroService[]; today: string }) {
  const [svc, setSvc] = useState(services[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [capacity, setCapacity] = useState<number | null>(null);

  useEffect(() => {
    if (!svc) return;
    const ac = new AbortController();
    setSlots(null);
    setCapacity(null);
    setFailed(false);
    const qs = new URLSearchParams({ serviceId: String(svc.id), from: today, to: addDays(today, 6) });
    fetch(`/api/availability?${qs}`, { signal: ac.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((j: { slots: Slot[]; capacity?: number }) => {
        setSlots(j.slots);
        setCapacity(typeof j.capacity === "number" ? j.capacity : null);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== "AbortError") {
          setFailed(true);
          setSlots([]);
        }
      });
    return () => ac.abort();
  }, [svc, today]);

  const free = useMemo(() => (slots ?? []).filter((s) => s.available), [slots]);
  const next = free.slice(0, 3);

  const label = (s: Slot) => {
    if (s.day === today) return `Hoy ${s.time}`;
    if (s.day === addDays(today, 1)) return `Mañana ${s.time}`;
    const [y, m, d] = s.day.split("-").map(Number);
    const wd = new Intl.DateTimeFormat("es-ES", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
    return `${cap(wd.replace(".", ""))} ${d} ${s.time}`;
  };
  const href = (s?: Slot) => {
    const qs = new URLSearchParams({ servicio: svc.slug });
    if (s) {
      qs.set("dia", s.day);
      qs.set("hora", s.time);
    }
    return `/reservar?${qs}`;
  };

  if (!svc) return null;
  // Escasez honesta: solo se muestra el número real, y solo si de verdad quedan pocos
  const n = capacity ?? free.length;
  const scarcity =
    slots === null ? null : n === 0 ? "Esta semana está completa." : n <= 12 ? `Esta semana quedan ${n} ${n === 1 ? "hueco" : "huecos"}.` : null;

  return (
    <div className="hb">
      <p className="hb__q"><span className="hb__live"><i className="live" aria-hidden="true" /> Huecos libres en directo</span></p>
      <div className="hb__chips" role="radiogroup" aria-label="Servicio">
        {services.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={s.id === svc.id} className={`hb__chip ${s.id === svc.id ? "is-on" : ""}`} onClick={() => setSvc(s)}>
            {s.name}
            <small>{fmtPrice(s.priceCents)}</small>
          </button>
        ))}
      </div>
      <div className="hb__slots" aria-live="polite">
        {slots === null && Array.from({ length: 3 }).map((_, i) => <span key={i} className="hb__skeleton" aria-hidden="true" />)}
        {next.map((s) => (
          <TransitionLink key={s.startsAt} href={href(s)} className="chip hb__slot">{label(s)}</TransitionLink>
        ))}
        {slots !== null && next.length === 0 && (
          <TransitionLink href={href()} className="chip hb__slot">{failed ? "Ver huecos" : "Ver más días o apuntarme a la lista de espera"}</TransitionLink>
        )}
      </div>
      <p className="hb__foot">
        {scarcity && <span className="hb__scarcity">{scarcity}</span>}
        <TransitionLink href={href()} className="hb__more">Ver todos los días y horas</TransitionLink>
      </p>
    </div>
  );
}
