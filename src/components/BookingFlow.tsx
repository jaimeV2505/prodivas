"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Lock, MessageCircle, Sparkles } from "lucide-react";
import { daysInMonth } from "@/lib/dates";
import PetalBurst from "./PetalBurst";
import { fmtDayLabel, fmtDuration, fmtLong, fmtMonth, fmtPrice } from "@/lib/format";

export type Service = {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
};
export type Staff = { id: number; name: string };
type Slot = { day: string; time: string; startsAt: string; available: boolean; staffIds: number[] };
type Hold = {
  holdId: string;
  holdToken: string;
  staffId: number;
  staffName: string;
  startsAt: string;
  deadline: number;
  total: number;
};
type Done = {
  code: string;
  token: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
};
type Step = "service" | "staff" | "time" | "details" | "done";

type Props = {
  services: Service[];
  staff: Staff[];
  initialSlug?: string;
  today: string;
  maxDate: string;
  whatsapp: string;
  address: string;
};

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const WEEK = ["L", "M", "X", "J", "V", "S", "D"];

function icsHref(d: Done, address: string): string {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pro Diva//Reservas//ES",
    "BEGIN:VEVENT",
    `UID:${d.code}@prodiva-melide`,
    `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(d.startsAt)}`,
    `DTEND:${f(d.endsAt)}`,
    `SUMMARY:${d.serviceName} en Pro Diva`,
    `LOCATION:${address.replace(/,/g, "\\,")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
}

export default function BookingFlow({ services, staff, initialSlug, today, maxDate, whatsapp, address }: Props) {
  const reduce = useReducedMotion();
  const multiStaff = staff.length > 1;
  const stepOrder: Step[] = multiStaff ? ["service", "staff", "time", "details"] : ["service", "time", "details"];
  const stepLabel: Record<string, string> = {
    service: "Servicio",
    staff: "Profesional",
    time: "Fecha y hora",
    details: "Tus datos",
  };

  const initialService = services.find((s) => s.slug === initialSlug) ?? null;
  const [service, setService] = useState<Service | null>(initialService);
  const [staffChoice, setStaffChoice] = useState<number | null>(null); // null = cualquiera
  const [step, setStep] = useState<Step>(initialService ? (multiStaff ? "staff" : "time") : "service");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [now, setNow] = useState(0);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "", consent: false, website: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  /* ---------- disponibilidad ---------- */
  const refresh = useCallback(async () => {
    if (!service) return;
    const from = `${month}-01`;
    const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
    const qs = new URLSearchParams({ serviceId: String(service.id), from, to });
    if (staffChoice !== null) qs.set("staffId", String(staffChoice));
    try {
      const r = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error("bad status");
      const j = (await r.json()) as { slots: Slot[] };
      setSlots(j.slots);
    } catch {
      setNotice((n) => n ?? { tone: "error", text: "No pudimos cargar los huecos. Revisa tu conexión." });
    }
  }, [service, staffChoice, month]);

  // Carga + sondeo cada 15 s + al volver a la pestaña: los huecos que otra persona
  // bloquea aparecen candados casi en tiempo real.
  useEffect(() => {
    if (step !== "time" || !service) return;
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [step, service, refresh]);

  const dayInfo = useMemo(() => {
    const m: Record<string, { free: number; total: number }> = {};
    for (const s of slots ?? []) {
      const d = (m[s.day] ??= { free: 0, total: 0 });
      d.total++;
      if (s.available) d.free++;
    }
    return m;
  }, [slots]);

  // Selecciona automáticamente el primer día con huecos
  useEffect(() => {
    if (!slots) return;
    if (day && dayInfo[day]) return;
    const first = Object.keys(dayInfo)
      .sort()
      .find((d) => dayInfo[d].free > 0);
    setDay(first ?? null);
  }, [slots, dayInfo, day]);

  /* ---------- bloqueo (hold) ---------- */
  const holdRef = useRef<Hold | null>(null);
  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  const release = useCallback((h: Hold) => {
    return fetch(`/api/holds/${h.holdId}?token=${encodeURIComponent(h.holdToken)}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }, []);

  const dropHold = () => {
    if (hold) {
      void release(hold);
      setHold(null);
    }
  };

  // Si cierra o recarga la pestaña, liberamos el hueco al instante
  useEffect(() => {
    const onHide = () => {
      if (holdRef.current) void release(holdRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [release]);

  // Cuenta atrás
  useEffect(() => {
    if (!hold) return;
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= hold.deadline) {
        setHold(null);
        setNotice({ tone: "info", text: "Se acabó el tiempo y liberamos el hueco. Elígelo de nuevo si sigue libre." });
        setStep((s) => (s === "details" ? "time" : s));
        void refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [hold, refresh]);

  const remaining = hold ? Math.max(0, Math.ceil((hold.deadline - now) / 1000)) : 0;
  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  async function pickSlot(slot: Slot) {
    if (!service || busySlot) return;
    if (hold?.startsAt === slot.startsAt) return;
    setNotice(null);
    setBusySlot(slot.startsAt);
    if (hold) {
      await release(hold);
      setHold(null);
    }
    try {
      const r = await fetch("/api/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, staffId: staffChoice, startsAt: slot.startsAt }),
      });
      const j = await r.json();
      if (!r.ok) {
        setNotice({ tone: "error", text: j?.error?.message ?? "No pudimos bloquear ese hueco." });
        await refresh();
      } else {
        setHold({
          holdId: j.holdId,
          holdToken: j.holdToken,
          staffId: j.staffId,
          staffName: j.staffName,
          startsAt: slot.startsAt,
          deadline: Date.now() + j.expiresInSec * 1000,
          total: j.expiresInSec,
        });
        await refresh();
      }
    } catch {
      setNotice({ tone: "error", text: "Sin conexión. Inténtalo de nuevo." });
    } finally {
      setBusySlot(null);
    }
  }

  /* ---------- navegación ---------- */
  function chooseService(s: Service) {
    dropHold();
    setService(s);
    setSlots(null);
    setDay(null);
    setNotice(null);
    setStep(multiStaff ? "staff" : "time");
  }
  function chooseStaff(id: number | null) {
    dropHold();
    setStaffChoice(id);
    setSlots(null);
    setDay(null);
    setNotice(null);
    setStep("time");
  }
  function back() {
    const i = stepOrder.indexOf(step);
    if (i <= 0) return;
    if (step === "details") {
      setStep("time");
      return;
    }
    dropHold();
    setNotice(null);
    setStep(stepOrder[i - 1]);
  }
  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  }

  /* ---------- confirmar ---------- */
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!hold || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdId: hold.holdId,
          holdToken: hold.holdToken,
          name: form.name,
          phone: form.phone,
          email: form.email,
          notes: form.notes,
          website: form.website,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        const code = j?.error?.code as string | undefined;
        setNotice({ tone: "error", text: j?.error?.message ?? "No pudimos confirmar la cita." });
        if (code === "SLOT_TAKEN" || code === "HOLD_EXPIRED" || code === "NOT_FOUND") {
          setHold(null);
          setStep("time");
          void refresh();
        }
        return;
      }
      setDone(j.booking as Done);
      setHold(null);
      setStep("done");
    } catch {
      setNotice({ tone: "error", text: "Sin conexión. Tu hueco sigue guardado: inténtalo otra vez." });
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- derivados ---------- */
  const [yy, mm] = month.split("-").map(Number);
  const lead = (new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() + 6) % 7;
  const total = daysInMonth(month);
  const canPrev = month > today.slice(0, 7);
  const canNext = month < maxDate.slice(0, 7);
  const daySlots = (slots ?? []).filter((s) => s.day === day);
  const morning = daySlots.filter((s) => Number(s.time.slice(0, 2)) < 15);
  const afternoon = daySlots.filter((s) => Number(s.time.slice(0, 2)) >= 15);
  const groups = useMemo(() => {
    const g: { category: string; items: Service[] }[] = [];
    for (const s of services) {
      let x = g.find((y) => y.category === s.category);
      if (!x) g.push((x = { category: s.category, items: [] }));
      x.items.push(s);
    }
    return g;
  }, [services]);
  const order = useMemo(() => new Map(services.map((s, i) => [s.id, i])), [services]);
  const staffName = hold?.staffName ?? (staffChoice ? staff.find((s) => s.id === staffChoice)?.name : null);
  const stepIndex = stepOrder.indexOf(step);

  // Entrada 260 ms ease-out; salida más rápida (140 ms). Con "reducir movimiento" se mantiene solo el fundido.
  // `transform` completo (no x/y) para que la animación no dependa del hilo principal.
  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, transform: "translateX(24px)" },
        animate: { opacity: 1, transform: "translateX(0px)" },
        exit: { opacity: 0, transform: "translateX(-16px)", transition: { duration: 0.14, ease: EASE_OUT } },
        transition: { duration: 0.26, ease: EASE_OUT },
      };

  // Función (no componente) para que los botones no se remonten en cada tic de la cuenta atrás
  function renderSlots(title: string, list: Slot[]) {
    if (!list.length) return null;
    return (
      <div className="slots__group">
        <h4>{title}</h4>
        <div className="slots__grid" role="group" aria-label={title}>
          {list.map((s) => {
            const mine = hold?.startsAt === s.startsAt;
            const taken = !s.available && !mine;
            return (
              <button
                key={s.startsAt}
                type="button"
                className={`slot ${mine ? "slot--mine" : ""} ${taken ? "slot--taken" : ""}`}
                disabled={taken || busySlot === s.startsAt}
                aria-pressed={mine}
                aria-label={taken ? `${s.time}, ocupado` : mine ? `${s.time}, bloqueado para ti` : s.time}
                onClick={() => void pickSlot(s)}
              >
                {mine && (
                  <motion.span
                    className="slot__lock"
                    initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", duration: 0.35, bounce: 0.2 }}
                  >
                    <Lock size={13} aria-hidden="true" />
                  </motion.span>
                )}
                {taken && <Lock size={12} aria-hidden="true" className="slot__lock--taken" />}
                {s.time}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flow">
      <div className="flow__main">
        {step !== "done" && (
          <ol className="progress" aria-label="Progreso de la reserva">
            {stepOrder.map((s, i) => (
              <li key={s} className={i < stepIndex ? "is-done" : i === stepIndex ? "is-current" : ""} aria-current={i === stepIndex ? "step" : undefined}>
                <span className="progress__dot">{i < stepIndex ? <Check size={12} aria-hidden="true" /> : i + 1}</span>
                <span className="progress__label">{stepLabel[s]}</span>
              </li>
            ))}
          </ol>
        )}

        {notice && (
          <div className={`notice notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.text}
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={step} className="panel" {...motionProps}>
            {/* ---------------- SERVICIO ---------------- */}
            {step === "service" && (
              <>
                <h2 className="panel__title">¿Qué te hacemos?</h2>
                {groups.map((g) => (
                  <div key={g.category} className="pick-group">
                    <h3>{g.category}</h3>
                    <ul className="pick-list">
                      {g.items.map((s) => (
                        <li key={s.id}>
                          <button type="button" className={`pick ${service?.id === s.id ? "is-on" : ""}`} style={{ ["--i" as string]: Math.min(order.get(s.id) ?? 0, 6) } as React.CSSProperties} onClick={() => chooseService(s)}>
                            <span className="pick__main">
                              <strong>{s.name}</strong>
                              {s.description && <small>{s.description}</small>}
                            </span>
                            <span className="pick__meta">{fmtDuration(s.durationMin)}</span>
                            <span className="pick__price">{fmtPrice(s.priceCents)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}

            {/* ---------------- PROFESIONAL ---------------- */}
            {step === "staff" && (
              <>
                <button type="button" className="back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> Cambiar servicio</button>
                <h2 className="panel__title">¿Con quién?</h2>
                <ul className="pick-list">
                  <li>
                    <button type="button" className={`pick ${staffChoice === null ? "is-on" : ""}`} onClick={() => chooseStaff(null)}>
                      <span className="pick__main">
                        <strong>La primera que esté libre</strong>
                        <small>Más huecos para elegir</small>
                      </span>
                      <Sparkles size={18} aria-hidden="true" />
                    </button>
                  </li>
                  {staff.map((s) => (
                    <li key={s.id}>
                      <button type="button" className={`pick ${staffChoice === s.id ? "is-on" : ""}`} onClick={() => chooseStaff(s.id)}>
                        <span className="pick__main"><strong>{s.name}</strong></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* ---------------- FECHA Y HORA ---------------- */}
            {step === "time" && service && (
              <>
                <button type="button" className="back" onClick={back}>
                  <ArrowLeft size={16} aria-hidden="true" /> {multiStaff ? "Cambiar profesional" : "Cambiar servicio"}
                </button>
                <h2 className="panel__title">Elige tu hueco</h2>

                <div className="cal" aria-label="Calendario">
                  <div className="cal__head">
                    <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} disabled={!canPrev} aria-label="Mes anterior">
                      <ChevronLeft size={18} aria-hidden="true" />
                    </button>
                    <strong aria-live="polite">{fmtMonth(month)}</strong>
                    <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} disabled={!canNext} aria-label="Mes siguiente">
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="cal__grid" role="grid">
                    {WEEK.map((w) => (
                      <span key={w} className="cal__wd" role="columnheader">{w}</span>
                    ))}
                    {Array.from({ length: lead }).map((_, i) => (
                      <span key={`b${i}`} />
                    ))}
                    {Array.from({ length: total }).map((_, i) => {
                      const ds = `${month}-${String(i + 1).padStart(2, "0")}`;
                      const info = dayInfo[ds];
                      const free = !!info && info.free > 0;
                      const full = !!info && info.free === 0;
                      const sel = ds === day;
                      return (
                        <button
                          key={ds}
                          type="button"
                          role="gridcell"
                          className={`cal__day ${free ? "is-free" : ""} ${full ? "is-full" : ""} ${sel ? "is-sel" : ""}`}
                          disabled={!free}
                          aria-label={`${fmtDayLabel(ds)}${free ? "" : full ? ", completo" : ", sin disponibilidad"}`}
                          aria-pressed={sel}
                          onClick={() => setDay(ds)}
                        >
                          <span className="cal__n">{i + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                  {slots === null && <p className="muted" aria-live="polite">Cargando huecos…</p>}
                  {slots !== null && Object.keys(dayInfo).length === 0 && (
                    <p className="muted">No quedan huecos este mes. Prueba con el siguiente.</p>
                  )}
                </div>

                {day && (
                  <div className="slots" aria-live="polite">
                    <h3 className="slots__day">{fmtDayLabel(day)}</h3>
                    {renderSlots("Mañana", morning)}
                    {renderSlots("Tarde", afternoon)}
                    <p className="legend">
                      <Lock size={12} aria-hidden="true" /> Ocupado o bloqueado por otra persona
                    </p>
                  </div>
                )}

                <AnimatePresence>
                  {hold && (
                    <motion.div
                      className="holdbar"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(12px)" }}
                      animate={reduce ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)", transition: { duration: 0.14, ease: EASE_OUT } }}
                      transition={{ duration: 0.24, ease: EASE_OUT }}
                    >
                      <div className="holdbar__row">
                        <span className="holdbar__icon"><Lock size={18} aria-hidden="true" /></span>
                        <div>
                          <strong>Hueco bloqueado para ti</strong>
                          <span>{fmtLong(hold.startsAt)}</span>
                        </div>
                        <span className="holdbar__time" aria-label={`Quedan ${mmss}`}>{mmss}</span>
                      </div>
                      <div className="holdbar__track" aria-hidden="true">
                        <i style={{ width: `${(remaining / hold.total) * 100}%` }} />
                      </div>
                      <button type="button" className="btn btn--primary btn--block" onClick={() => setStep("details")}>
                        Continuar
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* ---------------- DATOS ---------------- */}
            {step === "details" && hold && (
              <>
                <button type="button" className="back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> Cambiar hueco</button>
                <h2 className="panel__title">Tus datos</h2>
                <div className="holdmini" role="timer" aria-live="off">
                  <Clock size={15} aria-hidden="true" /> Tu hueco está guardado: quedan <strong>{mmss}</strong>
                </div>
                <form onSubmit={submit} className="form" noValidate={false}>
                  <label className="field">
                    <span>Nombre</span>
                    <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
                  </label>
                  <label className="field">
                    <span>Teléfono</span>
                    <input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="600 123 456" />
                  </label>
                  <label className="field">
                    <span>Email <em>(opcional, para enviarte la confirmación)</em></span>
                    <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Comentarios <em>(opcional)</em></span>
                    <textarea rows={3} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Alergias, diseño que te gusta, retirada de esmalte previo…" />
                  </label>
                  {/* honeypot */}
                  <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                  <label className="check">
                    <input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                    <span>Acepto que Pro Diva use mis datos para gestionar esta cita.</span>
                  </label>
                  <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={submitting}>
                    {submitting ? "Confirmando…" : "Confirmar cita"}
                  </button>
                </form>
              </>
            )}

            {/* ---------------- LISTO ---------------- */}
            {step === "done" && done && (
              <div className="done">
                <PetalBurst />
                <motion.svg
                  className="done__check"
                  viewBox="0 0 64 64"
                  width="84"
                  height="84"
                  aria-hidden="true"
                  initial={reduce ? false : { scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
                >
                  <circle cx="32" cy="32" r="30" fill="var(--magenta)" />
                  <motion.path
                    d="M19 33 l9 9 l17 -19"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={reduce ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.25, duration: 0.5, ease: "easeOut" }}
                  />
                </motion.svg>
                <h2 className="panel__title">¡Cita confirmada!</h2>
                <p className="done__when">{fmtLong(done.startsAt)}</p>
                <p className="muted">
                  {done.serviceName}
                  {multiStaff ? ` con ${done.staffName}` : ""} · {fmtPrice(done.priceCents)}
                </p>
                <p className="muted">{address}</p>
                <p className="done__code">Código <strong>{done.code}</strong></p>
                <div className="done__actions">
                  <a className="btn btn--primary" href={icsHref(done, address)} download={`cita-prodiva-${done.code}.ics`}>
                    <CalendarPlus size={17} aria-hidden="true" /> Añadir al calendario
                  </a>
                  <a
                    className="btn btn--ghost"
                    href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, soy ${form.name}. He reservado ${done.serviceName} el ${fmtLong(done.startsAt)} (código ${done.code}).`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={17} aria-hidden="true" /> Avisar por WhatsApp
                  </a>
                  <Link className="btn btn--ghost" href={`/reserva/${done.code}?t=${done.token}`}>Ver o cancelar mi cita</Link>
                </div>
                <p className="muted small">Guarda este enlace: es la única forma de gestionar tu cita online.</p>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      {step !== "done" && (
        <aside className="summary" aria-label="Resumen de tu cita">
          <h2>Tu cita</h2>
          <dl>
            <dt>Servicio</dt>
            <dd>{service ? service.name : "Sin elegir"}</dd>
            {service && (
              <>
                <dt>Duración y precio</dt>
                <dd>{fmtDuration(service.durationMin)} · {fmtPrice(service.priceCents)}</dd>
              </>
            )}
            {multiStaff && (
              <>
                <dt>Profesional</dt>
                <dd>{staffName ?? (step === "service" || step === "staff" ? "Sin elegir" : "La primera libre")}</dd>
              </>
            )}
            <dt>Fecha y hora</dt>
            <dd>{hold ? fmtLong(hold.startsAt) : "Sin elegir"}</dd>
          </dl>
          {hold && step !== "details" && <p className="summary__hold"><Lock size={13} aria-hidden="true" /> Bloqueado {mmss}</p>}
        </aside>
      )}
    </div>
  );
}
