"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Eye, Flower2, Hand, Lock, MapPin, Sparkles, type LucideIcon } from "lucide-react";
import { addDays } from "@/lib/dates";
import { fmtDayLabel, fmtDuration, fmtLong, fmtPrice } from "@/lib/format";
import type { Service } from "./BookingFlow";
import WaitlistForm from "./WaitlistForm";

type Step = "home" | "category" | "service" | "day" | "time" | "details" | "done";
type Slot = { day: string; time: string; startsAt: string; available: boolean };
type Hold = { holdId: string; holdToken: string; startsAt: string; deadline: number };
type Last = { code: string; token: string; startsAt: string; serviceName: string };
type Done = Last & { endsAt: string };

const iconFor = (cat: string): LucideIcon =>
  /manicura|pedicura|u(ñ|n)as/i.test(cat) ? Hand : /mirada|pesta|ceja/i.test(cat) ? Eye : /depila/i.test(cat) ? Sparkles : Flower2;

/**
 * Reserva "modo fácil": una sola pregunta por pantalla, botones enormes, sin calendario,
 * siempre con la opción de llamar. Pensada para quien no se maneja con la web.
 */
export default function EasyBooking({
  services,
  today,
  address,
  mapsUrl,
  initialSlug,
  initialDay,
}: {
  services: Service[];
  today: string;
  address: string;
  mapsUrl: string;
  initialSlug?: string;
  initialDay?: string;
}) {
  // Enlaces de "se ha liberado un hueco": entran directos al servicio (y al día) elegidos
  const initSvc = services.find((x) => x.slug === initialSlug) ?? null;
  const initDay = initialDay && initialDay >= today ? initialDay : null;
  const [step, setStep] = useState<Step>(initSvc ? (initDay ? "time" : "day") : "home");
  const [category, setCategory] = useState<string | null>(initSvc?.category ?? null);
  const [service, setService] = useState<Service | null>(initSvc);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [showAllDays, setShowAllDays] = useState(false);
  const [day, setDay] = useState<string | null>(initSvc ? initDay : null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [done, setDone] = useState<Done | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const holdRef = useRef<Hold | null>(null);

  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  // Cita guardada en este móvil: al abrir la app se ve enseguida
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pd_last");
      if (raw) {
        const l = JSON.parse(raw) as Last;
        if (new Date(l.startsAt).getTime() > Date.now()) setLast(l);
      }
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, []);

  const categories = useMemo(() => Array.from(new Set(services.map((s) => s.category))), [services]);

  const loadSlots = useCallback(async () => {
    if (!service) return;
    const qs = new URLSearchParams({ serviceId: String(service.id), from: today, to: addDays(today, 20) });
    try {
      const r = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setSlots(((await r.json()) as { slots: Slot[] }).slots);
    } catch {
      setNotice("No hemos podido ver los huecos. Revisa tu internet o llámanos.");
    }
  }, [service, today]);

  useEffect(() => {
    if (service && (step === "day" || step === "time")) void loadSlots();
  }, [service, step, loadSlots]);

  const release = useCallback((h: Hold) => {
    return fetch(`/api/holds/${h.holdId}?token=${encodeURIComponent(h.holdToken)}`, { method: "DELETE", keepalive: true }).catch(() => {});
  }, []);
  useEffect(() => {
    const onHide = () => holdRef.current && void release(holdRef.current);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [release]);

  useEffect(() => {
    if (!hold) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= hold.deadline) {
        setHold(null);
        setNotice("Se acabó el tiempo y hemos liberado el hueco. Elige la hora otra vez.");
        setStep("time");
        void loadSlots();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [hold, loadSlots]);

  const dropHold = () => {
    if (hold) {
      void release(hold);
      setHold(null);
    }
  };

  const days = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots ?? []) if (s.available) set.add(s.day);
    return Array.from(set).sort();
  }, [slots]);
  const dayLabel = (d: string) => (d === today ? "Hoy" : d === addDays(today, 1) ? "Mañana" : fmtDayLabel(d));
  const times = (slots ?? []).filter((s) => s.day === day && s.available);
  const morning = times.filter((s) => Number(s.time.slice(0, 2)) < 15);
  const afternoon = times.filter((s) => Number(s.time.slice(0, 2)) >= 15);
  const remaining = hold ? Math.max(0, Math.ceil((hold.deadline - now) / 1000)) : 0;

  function back() {
    setNotice(null);
    if (step === "category") setStep("home");
    else if (step === "service") setStep("category");
    else if (step === "day") setStep("service");
    else if (step === "time") {
      dropHold();
      setStep("day");
    } else if (step === "details") setStep("time");
  }

  async function pickTime(slot: Slot) {
    if (!service || busy) return;
    setBusy(true);
    setNotice(null);
    if (hold) {
      await release(hold);
      setHold(null);
    }
    try {
      const r = await fetch("/api/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, staffId: null, startsAt: slot.startsAt }),
      });
      const j = await r.json();
      if (!r.ok) {
        setNotice(j?.error?.message ?? "Ese hueco ya no está libre. Elige otro.");
        await loadSlots();
        return;
      }
      setHold({ holdId: j.holdId, holdToken: j.holdToken, startsAt: slot.startsAt, deadline: Date.now() + j.expiresInSec * 1000 });
      setStep("details");
    } catch {
      setNotice("No hay conexión. Inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!hold || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdId: hold.holdId, holdToken: hold.holdToken, name: form.name, phone: form.phone }),
      });
      const j = await r.json();
      if (!r.ok) {
        setNotice(j?.error?.message ?? "No hemos podido confirmar la cita.");
        const code = j?.error?.code as string | undefined;
        if (code === "SLOT_TAKEN" || code === "HOLD_EXPIRED" || code === "NOT_FOUND") {
          setHold(null);
          setStep("time");
          void loadSlots();
        }
        return;
      }
      const b = j.booking as Done;
      setDone(b);
      setHold(null);
      setStep("done");
      try {
        localStorage.setItem("pd_last", JSON.stringify({ code: b.code, token: b.token, startsAt: b.startsAt, serviceName: b.serviceName }));
      } catch {
        /* nada */
      }
    } catch {
      setNotice("No hay conexión. Tu hueco sigue guardado: inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep("home");
    setCategory(null);
    setService(null);
    setSlots(null);
    setDay(null);
    setDone(null);
    setNotice(null);
    setForm({ name: "", phone: "" });
    const raw = localStorage.getItem("pd_last");
    if (raw) setLast(JSON.parse(raw) as Last);
  }

  const Back = () => (
    <button type="button" className="easy__back" onClick={back}>
      <ArrowLeft size={26} aria-hidden="true" /> Atrás
    </button>
  );

  return (
    <div className="easy">
      {notice && <p className="notice notice--error easy__notice" role="alert">{notice}</p>}

      {step === "home" && (
        <>
          {last && (
            <section className="easy__card easy__next">
              <p className="easy__label">Tu próxima cita</p>
              <p className="easy__when">{fmtLong(last.startsAt)}</p>
              <p>{last.serviceName}</p>
              <a className="easy__btn easy__btn--soft" href={`/c/${last.code}?t=${last.token}`}>Ver, confirmar o cancelar</a>
            </section>
          )}
          <h1 className="easy__h">¿Quieres pedir cita?</h1>
          <button type="button" className="easy__btn easy__btn--main" onClick={() => setStep("category")}>
            Pedir cita
          </button>
        </>
      )}

      {step === "category" && (
        <>
          <Back />
          <h1 className="easy__h">¿Qué te quieres hacer?</h1>
          <div className="easy__list">
            {categories.map((c) => {
              const Icon = iconFor(c);
              return (
                <button key={c} type="button" className="easy__btn easy__btn--tile" onClick={() => { setCategory(c); setStep("service"); }}>
                  <Icon size={34} aria-hidden="true" /> {c}
                </button>
              );
            })}
          </div>
        </>
      )}

      {step === "service" && (
        <>
          <Back />
          <h1 className="easy__h">{category}</h1>
          <div className="easy__list">
            {services.filter((s) => s.category === category).map((s) => (
              <button
                key={s.id}
                type="button"
                className="easy__btn easy__btn--row"
                onClick={() => {
                  dropHold();
                  setService(s);
                  setSlots(null);
                  setDay(null);
                  setShowAllDays(false);
                  setStep("day");
                }}
              >
                <span><b>{s.name}</b><small>{fmtDuration(s.durationMin)}</small></span>
                <span className="easy__price">{fmtPrice(s.priceCents)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === "day" && service && (
        <>
          <Back />
          <h1 className="easy__h">¿Qué día te viene bien?</h1>
          <p className="easy__sub">{service.name}</p>
          {slots === null && <p className="easy__sub">Buscando huecos…</p>}
          {slots !== null && days.length === 0 && (
            <>
              <p className="easy__sub">No quedan huecos en los próximos días.</p>
              <WaitlistForm serviceId={service.id} day={null} source="app" startOpen />
            </>
          )}
          <div className="easy__list">
            {(showAllDays ? days : days.slice(0, 6)).map((d) => (
              <button key={d} type="button" className="easy__btn easy__btn--tile" onClick={() => { setDay(d); setStep("time"); }}>
                {dayLabel(d)}
              </button>
            ))}
            {!showAllDays && days.length > 6 && (
              <button type="button" className="easy__btn easy__btn--soft" onClick={() => setShowAllDays(true)}>Ver más días</button>
            )}
          </div>
        </>
      )}

      {step === "time" && day && (
        <>
          <Back />
          <h1 className="easy__h">¿A qué hora?</h1>
          <p className="easy__sub">{dayLabel(day)}</p>
          {[{ t: "Por la mañana", l: morning }, { t: "Por la tarde", l: afternoon }].map(
            (g) =>
              g.l.length > 0 && (
                <div key={g.t}>
                  <h2 className="easy__group">{g.t}</h2>
                  <div className="easy__times">
                    {g.l.map((s) => (
                      <button key={s.startsAt} type="button" className="easy__btn easy__btn--time" disabled={busy} onClick={() => void pickTime(s)}>
                        {s.time}
                      </button>
                    ))}
                  </div>
                </div>
              ),
          )}
          {times.length === 0 && slots !== null && <p className="easy__sub">Ese día ya no quedan huecos. Elige otro día o te avisamos si se libera uno.</p>}
          {service && slots !== null && (
            <WaitlistForm key={day} serviceId={service.id} day={day} dayLabel={dayLabel(day)} source="app" startOpen={times.length === 0} />
          )}
        </>
      )}

      {step === "details" && service && hold && (
        <>
          <Back />
          <h1 className="easy__h">Tus datos</h1>
          <div className="easy__card easy__summary">
            <p><b>{service.name}</b></p>
            <p className="easy__when">{fmtLong(hold.startsAt)}</p>
            <p className="easy__hold"><Lock size={20} aria-hidden="true" /> Hueco guardado para ti: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</p>
          </div>
          <form onSubmit={confirm} className="easy__form">
            <label className="easy__field">
              <span>Tu nombre</span>
              <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
            </label>
            <label className="easy__field">
              <span>Tu teléfono (te avisaremos por mensaje)</span>
              <input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="600 123 456" />
            </label>
            <button type="submit" className="easy__btn easy__btn--main" disabled={busy}>
              {busy ? "Confirmando…" : "Confirmar mi cita"}
            </button>
            <p className="easy__legal">Al confirmar, Pro Diva usará tus datos para gestionar tu cita y enviarte la confirmación y un recordatorio por WhatsApp o SMS.</p>
          </form>
        </>
      )}

      {step === "done" && done && (
        <section className="easy__done">
          <span className="easy__tick"><Check size={56} aria-hidden="true" /></span>
          <h1 className="easy__h">¡Cita confirmada!</h1>
          <p className="easy__when">{fmtLong(done.startsAt)}</p>
          <p>{done.serviceName}</p>
          <p className="easy__sub">El mismo día te escribiremos para que confirmes con un toque.</p>
          <a className="easy__btn easy__btn--soft" href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <MapPin size={26} aria-hidden="true" /> Cómo llegar
          </a>
          <p className="muted">{address}</p>
          <button type="button" className="easy__btn easy__btn--main" onClick={restart}>Terminar</button>
        </section>
      )}
    </div>
  );
}
