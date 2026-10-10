"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Lock, MessageCircle, Sparkles } from "lucide-react";
import { daysInMonth } from "@/lib/dates";
import { saveBooking } from "@/lib/myBookings";
import type { Trend } from "@/lib/trends";
import { useStepHistory } from "@/lib/useStepHistory";
import BookingAvatar, { type AvatarState } from "./BookingAvatar";
import PetalBurst from "./PetalBurst";
import WaitlistForm from "./WaitlistForm";
import { fmtDayLabel, fmtDuration, fmtHM, fmtLong, fmtMonth, fmtPrice } from "@/lib/format";

export type Service = {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  depositCents?: number;
};
export type Staff = { id: number; name: string };
type Slot = { day: string; time: string; startsAt: string; available: boolean; staffIds: number[] };
type Hold = {
  holdId: string;
  holdToken: string;
  staffId: number;
  staffName: string;
  startsAt: string;
  endsAt: string;
  blockedMin: number;
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
/** Visita en horas distintas: una cita por servicio, cada una con su día, su hora y su bloqueo. */
type Leg = { service: Service; day: string | null; hold: Hold | null };

type Props = {
  services: Service[];
  staff: Staff[];
  initialSlug?: string;
  initialDay?: string;
  initialTime?: string;
  initialColor?: string;
  initialExtras?: string[];
  trends?: Trend[];
  today: string;
  maxDate: string;
  whatsapp: string;
  address: string;
  depositEnabled?: boolean;
  refundHours?: number;
};

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const WEEK = ["L", "M", "X", "J", "V", "S", "D"];

function icsHref(list: Done[], address: string): string {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const events = list.flatMap((d) => [
    "BEGIN:VEVENT",
    `UID:${d.code}@prodiva-melide`,
    `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(d.startsAt)}`,
    `DTEND:${f(d.endsAt)}`,
    `SUMMARY:${d.serviceName} en Pro Diva`,
    `LOCATION:${address.replace(/,/g, "\\,")}`,
    "END:VEVENT",
  ]);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pro Diva//Reservas//ES", ...events, "END:VCALENDAR"];
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
}

export default function BookingFlow({ services, staff, initialSlug, initialDay, initialTime, initialColor, initialExtras, trends = [], today, maxDate, whatsapp, address, depositEnabled = false, refundHours = 24 }: Props) {
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
  const [step, setStep] = useState<Step>(initialService ? (multiStaff && !initialTime ? "staff" : "time") : "service");
  const [month, setMonth] = useState((initialDay && initialDay >= today ? initialDay : today).slice(0, 7));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [dayT, setDayT] = useState<string | null>(initialDay && initialDay >= today ? initialDay : null);
  const [holdT, setHoldT] = useState<Hold | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [now, setNow] = useState(0);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: initialColor ? `Color: ${initialColor}` : "", consent: false, website: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [doneAll, setDoneAll] = useState<Done[]>([]);
  const [extras, setExtras] = useState<Service[]>(() =>
    (initialExtras ?? [])
      .map((slug) => services.find((x) => x.slug === slug))
      .filter((x): x is Service => !!x && x.id !== initialService?.id)
      .slice(0, 3),
  );
  const [addOpen, setAddOpen] = useState(false);

  // Visita en horas distintas ("apart"): una cita por servicio. Si no, todos seguidos en un solo bloque.
  const [apart, setApart] = useState(false);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [activeLeg, setActiveLeg] = useState(0);
  const cur: Leg | undefined = apart ? legs[activeLeg] : undefined;
  // `hold` y `day` son los de la cita que se está eligiendo ahora (la única, o la activa si van en horas distintas)
  const hold: Hold | null = apart ? cur?.hold ?? null : holdT;
  const day: string | null = apart ? cur?.day ?? null : dayT;
  const setDay = (d: string | null) => {
    if (apart) setLegs((ls) => ls.map((l, i) => (i === activeLeg ? { ...l, day: d } : l)));
    else setDayT(d);
  };

  // Servicios de la visita (hasta 4) y los que se consultan ahora al pedir huecos
  const visitServices = useMemo(() => (apart ? legs.map((l) => l.service) : service ? [service, ...extras] : []), [apart, legs, service, extras]);
  const availServices = apart ? (cur ? [cur.service] : []) : visitServices;
  const availKey = availServices.map((x) => x.id).join(",");
  const totalDuration = visitServices.reduce((a, x) => a + x.durationMin, 0);
  const totalPrice = visitServices.reduce((a, x) => a + x.priceCents, 0);
  const totalDeposit = visitServices.reduce((a, x) => a + (x.depositCents ?? 0), 0);
  const needsDeposit = depositEnabled && totalDeposit > 0;

  /* ---------- disponibilidad ---------- */
  const refresh = useCallback(async (h?: Hold | null) => {
    if (!availKey) return;
    const own = h === undefined ? holdRef.current : h; // el bloqueo propio no cuenta como "ocupado" para ella
    const from = `${month}-01`;
    const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
    const qs = new URLSearchParams({ serviceIds: availKey, from, to });
    if (staffChoice !== null) qs.set("staffId", String(staffChoice));
    if (own) {
      qs.set("holdId", own.holdId);
      qs.set("holdToken", own.holdToken);
    }
    try {
      const r = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error("bad status");
      const j = (await r.json()) as { slots: Slot[] };
      setSlots(j.slots);
    } catch {
      setNotice((n) => n ?? { tone: "error", text: "No pudimos cargar los huecos. Revisa tu conexión." });
    }
  }, [availKey, staffChoice, month]);

  // Carga + sondeo cada 15 s + al volver a la pestaña: los huecos que otra persona
  // bloquea aparecen candados casi en tiempo real.
  useEffect(() => {
    if (step !== "time" || !availKey) return;
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    const onVis = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [step, availKey, refresh]);

  // Llegada desde un hueco del hero ("Hoy 17:15"): se bloquea solo y se pasa directo a los datos
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || !initialTime || !initialDay || !slots || !service || step !== "time") return;
    autoPicked.current = true;
    const target = slots.find((x) => x.day === initialDay && x.time === initialTime);
    if (target?.available) void pickSlot(target, true);
    else setNotice({ tone: "info", text: "Ese hueco ya no está libre. Elige otro de la lista." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, service, step]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, dayInfo, day]);

  /* ---------- bloqueos (hold) ---------- */
  const holdRef = useRef<Hold | null>(null);
  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  // Todos los bloqueos vivos (uno, o uno por cita si van en horas distintas)
  const allHolds = useMemo(() => (apart ? legs.flatMap((l) => (l.hold ? [l.hold] : [])) : holdT ? [holdT] : []), [apart, legs, holdT]);
  const allHoldsRef = useRef<Hold[]>([]);
  useEffect(() => {
    allHoldsRef.current = allHolds;
  }, [allHolds]);
  const allHeld = apart ? legs.length > 0 && legs.every((l) => !!l.hold) : !!holdT;

  const release = useCallback((h: Hold) => {
    return fetch(`/api/holds/${h.holdId}?token=${encodeURIComponent(h.holdToken)}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  }, []);

  const clearAllHolds = () => {
    setHoldT(null);
    setLegs((ls) => ls.map((l) => (l.hold ? { ...l, hold: null } : l)));
  };
  // Libera todos los bloqueos en el servidor y los olvida
  const dropHold = () => {
    for (const h of allHoldsRef.current) void release(h);
    allHoldsRef.current = [];
    holdRef.current = null;
    clearAllHolds();
  };

  // Si cierra o recarga la pestaña, liberamos los huecos al instante
  useEffect(() => {
    const onHide = () => {
      for (const h of allHoldsRef.current) void release(h);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [release]);

  // Cuenta atrás: al guardar otra hora, el servidor alarga los bloqueos hermanos, así que caducan a la vez
  const deadline = allHolds.length ? Math.min(...allHolds.map((h) => h.deadline)) : 0;
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) {
        clearAllHolds();
        setNotice({ tone: "info", text: "Se acabó el tiempo y liberamos tus huecos. Elígelos de nuevo si siguen libres." });
        setStep((s) => (s === "details" ? "time" : s));
        void refresh(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, refresh]);

  const remaining = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const holdTotalSec = hold?.total ?? allHolds[0]?.total ?? 600;

  async function pickSlot(slot: Slot, advance = false) {
    if (!availServices.length || busySlot) return;
    if (hold?.startsAt === slot.startsAt) {
      if (advance) setStep("details");
      return;
    }
    setNotice(null);
    setBusySlot(slot.startsAt);
    const legIndex = activeLeg;
    const siblings = apart ? legs.filter((l, i) => i !== legIndex && l.hold).map((l) => l.hold as Hold) : [];
    try {
      // Si ya tenía un hueco guardado para esta cita, el servidor lo cambia por el nuevo en una sola operación:
      // si el nuevo falla, el anterior sigue guardado (no se queda sin hueco por probar otra hora).
      const r = await fetch("/api/holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceIds: availServices.map((x) => x.id),
          staffId: staffChoice,
          startsAt: slot.startsAt,
          ...(hold ? { replaceHoldId: hold.holdId, replaceToken: hold.holdToken } : {}),
          ...(siblings.length ? { extend: siblings.map((h) => ({ holdId: h.holdId, holdToken: h.holdToken })) } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setNotice({ tone: "error", text: j?.error?.message ?? "No pudimos bloquear ese hueco." });
        await refresh();
      } else {
        const deadlineNew = Date.now() + j.expiresInSec * 1000;
        const next: Hold = {
          holdId: j.holdId,
          holdToken: j.holdToken,
          staffId: j.staffId,
          staffName: j.staffName,
          startsAt: slot.startsAt,
          endsAt: j.endsAt,
          blockedMin: j.blockedMin,
          deadline: deadlineNew,
          total: j.expiresInSec,
        };
        if (apart) {
          const ext: string[] = j.extendedIds ?? [];
          const lost = legs.filter((l, i) => i !== legIndex && l.hold && !ext.includes(l.hold.holdId)).map((l) => l.service.name);
          setLegs((ls) =>
            ls.map((l, i) => {
              if (i === legIndex) return { ...l, hold: next };
              if (!l.hold) return l;
              if (ext.includes(l.hold.holdId)) return { ...l, hold: { ...l.hold, deadline: deadlineNew, total: j.expiresInSec } };
              return { ...l, hold: null }; // ese bloqueo ya había caducado
            }),
          );
          if (lost.length) setNotice({ tone: "info", text: `La hora de ${lost.join(" y ")} había caducado: elígela otra vez.` });
          // pasa sola a la siguiente cita que aún no tiene hora
          const nextIdx = legs.findIndex((l, i) => i !== legIndex && (!l.hold || !ext.includes(l.hold.holdId)));
          if (nextIdx >= 0) {
            holdRef.current = null;
            setSlots(null); // los huecos de la cita anterior no valen para la siguiente: se piden de nuevo
            setActiveLeg(nextIdx);
            const d = legs[nextIdx].day;
            if (d) setMonth(d.slice(0, 7));
          } else {
            holdRef.current = next;
            await refresh(next);
          }
        } else {
          setHoldT(next);
          holdRef.current = next;
          if (advance) setStep("details");
          await refresh(next);
        }
      }
    } catch {
      setNotice({ tone: "error", text: "Sin conexión. Inténtalo de nuevo." });
    } finally {
      setBusySlot(null);
    }
  }

  /* ---------- navegación ---------- */
  // En horas distintas, el primer servicio de la lista es siempre `service` (se usa en varios sitios)
  function commitLegs(next: Leg[]) {
    setLegs(next);
    setService(next[0]?.service ?? null);
  }
  function addExtra(s: Service) {
    if (visitServices.length >= 4 || visitServices.some((v) => v.id === s.id)) return;
    if (apart) {
      commitLegs([...legs, { service: s, day: null, hold: null }]); // las demás citas conservan su hueco
    } else {
      dropHold();
      setExtras((e) => [...e, s]);
    }
    setSlots(null);
    setAddOpen(false);
    setNotice(null);
  }
  function removeService(id: number) {
    if (visitServices.length < 2) return; // tiene que quedar al menos uno
    if (apart) {
      const idx = legs.findIndex((l) => l.service.id === id);
      if (idx < 0) return;
      if (legs[idx].hold) void release(legs[idx].hold as Hold);
      const rest = legs.filter((_, i) => i !== idx);
      if (rest.length === 1) {
        // queda una sola cita: vuelve a «todo seguido» conservando su hueco
        const only = rest[0];
        setApart(false);
        setLegs([]);
        setActiveLeg(0);
        setService(only.service);
        setExtras([]);
        setHoldT(only.hold);
        setDayT(only.day);
      } else {
        commitLegs(rest);
        setActiveLeg(Math.min(activeLeg > idx ? activeLeg - 1 : activeLeg, rest.length - 1));
      }
    } else {
      dropHold();
      if (service && id === service.id) {
        const [first, ...rest] = extras;
        if (first) {
          setService(first);
          setExtras(rest);
        }
      } else {
        setExtras((e) => e.filter((x) => x.id !== id));
      }
    }
    setSlots(null);
    setNotice(null);
  }
  // «Todo seguido» ⇄ «Cada servicio a su hora»
  function goApart() {
    if (visitServices.length < 2) return;
    dropHold();
    setLegs(visitServices.map((s) => ({ service: s, day: null, hold: null })));
    setActiveLeg(0);
    setApart(true);
    setSlots(null);
    setNotice(null);
  }
  function goTogether() {
    const sv = legs.map((l) => l.service);
    dropHold();
    setApart(false);
    setLegs([]);
    setActiveLeg(0);
    setService(sv[0] ?? null);
    setExtras(sv.slice(1));
    setDayT(null);
    setSlots(null);
    setNotice(null);
  }
  function selectLeg(i: number) {
    if (i === activeLeg || !legs[i]) return;
    setActiveLeg(i);
    setSlots(null);
    setNotice(null);
    const d = legs[i].day;
    if (d) setMonth(d.slice(0, 7));
  }
  function chooseService(s: Service) {
    dropHold();
    setApart(false);
    setLegs([]);
    setActiveLeg(0);
    setExtras([]);
    setAddOpen(false);
    setService(s);
    setSlots(null);
    setDayT(null);
    setNotice(null);
    setStep(multiStaff ? "staff" : "time");
  }
  function chooseStaff(id: number | null) {
    dropHold();
    setStaffChoice(id);
    setSlots(null);
    setDay(null);
    setDayT(null);
    setLegs((ls) => ls.map((l) => ({ ...l, day: null })));
    setNotice(null);
    setStep("time");
  }
  // Nueva cita: se conservan nombre, teléfono y email para no escribirlos otra vez
  function reset() {
    dropHold();
    setApart(false);
    setLegs([]);
    setActiveLeg(0);
    setService(null);
    setExtras([]);
    setAddOpen(false);
    setStaffChoice(null);
    setSlots(null);
    setDayT(null);
    setDone(null);
    setDoneAll([]);
    setNotice(null);
    setForm((f) => ({ ...f, notes: "" }));
    setStep("service");
  }
  // Paso anterior; devuelve true si ha cambiado de paso. El botón "Atrás" del móvil usa la misma lógica.
  function stepBack(): boolean {
    if (step === "done") {
      reset(); // desde la confirmación, atrás = el menú de reserva
      return true;
    }
    const i = stepOrder.indexOf(step);
    if (i <= 0) return false;
    if (step === "details") {
      setStep("time");
      return true;
    }
    dropHold();
    setNotice(null);
    setStep(stepOrder[i - 1]);
    return true;
  }
  const back = useStepHistory(step, stepBack);

  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  }

  // Desde el avatar: añadir un servicio a la visita con un toque
  function addFromAvatar(slug: string): "added" | "chosen" | "already" | "full" | "missing" {
    const s = services.find((x) => x.slug === slug);
    if (!s) return "missing";
    if (visitServices.some((v) => v.id === s.id)) return "already";
    if (step === "service" || !service) {
      chooseService(s);
      return "chosen";
    }
    if (step === "done" || step === "details") return "missing";
    if (visitServices.length >= 4) return "full";
    addExtra(s);
    return "added";
  }

  /* ---------- confirmar ---------- */
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !allHeld) return;
    setSubmitting(true);
    setNotice(null);
    const who = { name: form.name, phone: form.phone, email: form.email, notes: form.notes, website: form.website };
    try {
      const r = await fetch(apart ? "/api/bookings/batch" : "/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          apart
            ? { legs: legs.map((l) => ({ holdId: (l.hold as Hold).holdId, holdToken: (l.hold as Hold).holdToken })), ...who }
            : { holdId: (holdT as Hold).holdId, holdToken: (holdT as Hold).holdToken, ...who },
        ),
      });
      const j = await r.json();
      if (!r.ok) {
        const code = j?.error?.code as string | undefined;
        setNotice({ tone: "error", text: j?.error?.message ?? "No pudimos confirmar la cita." });
        if (code === "SLOT_TAKEN" || code === "HOLD_EXPIRED" || code === "NOT_FOUND") {
          // una de las horas ya no vale: se liberan todas (el servidor no dice cuál) y se vuelve a elegir
          dropHold();
          setStep("time");
          void refresh(null);
        } else if (code === "CONFLICT") {
          setStep("time"); // coincide con otra cita suya: que cambie la hora (los huecos siguen guardados)
        }
        return;
      }
      if (j.checkoutUrl) {
        // Pago de la señal en Stripe: los huecos deben seguir bloqueados mientras tanto
        holdRef.current = null;
        allHoldsRef.current = [];
        window.location.assign(j.checkoutUrl as string);
        return;
      }
      const list = (apart ? j.bookings : [j.booking]) as Done[];
      for (const b of list) saveBooking(b.code, b.token);
      allHoldsRef.current = [];
      holdRef.current = null;
      setDoneAll(list);
      setDone(list[0]);
      clearAllHolds(); // confirmadas: no hay nada que liberar
      setStep("done");
    } catch {
      setNotice({ tone: "error", text: "Sin conexión. Tus huecos siguen guardados: inténtalo otra vez." });
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
  const avatarState: AvatarState = step === "done" ? "done" : step === "details" ? "typing" : allHolds.length ? "held" : "browse";
  const nextPendingIdx = apart ? legs.findIndex((l) => !l.hold) : -1;
  // Si van en horas distintas, el tramo de las otras citas se marca para no solaparlas
  const otherSpans = apart ? legs.flatMap((l, i) => (i !== activeLeg && l.hold ? [{ start: new Date(l.hold.startsAt).getTime(), end: new Date(l.hold.endsAt).getTime(), name: l.service.name }] : [])) : [];
  const curDurMs = (availServices[0]?.durationMin ?? 0) * 60000;
  const nextMonthLabel = fmtMonth(new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 7));
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
            const sStart = new Date(s.startsAt).getTime();
            // coincide con otra cita suya (visita en horas distintas)
            const clash = mine ? undefined : otherSpans.find((o) => sStart < o.end && o.start < sStart + curDurMs);
            const taken = !s.available && !mine && !clash;
            // empieza dentro del tiempo que ocupa su cita: se ve bloqueado como parte de ella, y al pulsarlo la cita se mueve ahí
            const range = !!hold && !!hold.endsAt && !mine && !clash && !taken && sStart > new Date(hold.startsAt).getTime() && sStart < new Date(hold.endsAt).getTime(); // se compara por instante, no por texto
            return (
              <button
                key={s.startsAt}
                type="button"
                className={`slot ${mine ? "slot--mine" : ""} ${taken ? "slot--taken" : ""} ${clash ? "slot--yours" : ""} ${range ? "slot--range" : ""}`}
                title={clash ? `Coincide con tu cita de ${clash.name}` : range && hold ? `Parte de tu cita (${fmtHM(hold.startsAt)} a ${fmtHM(hold.endsAt)}). Púlsalo para mover tu cita aquí.` : undefined}
                disabled={taken || !!clash || busySlot === s.startsAt}
                aria-pressed={mine}
                aria-label={clash ? `${s.time}, coincide con tu cita de ${clash.name}` : taken ? `${s.time}, ocupado` : mine ? `${s.time}, bloqueado para ti` : range ? `${s.time}, parte de tu cita` : s.time}
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
                {range && <Lock size={11} aria-hidden="true" className="slot__lock--range" />}
                {clash && <Clock size={12} aria-hidden="true" className="slot__lock--yours" />}
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
                <Link href="/" className="back"><ArrowLeft size={16} aria-hidden="true" /> Volver al inicio</Link>
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
                <h2 className="panel__title">{apart && cur ? `Elige la hora de ${cur.service.name}` : "Elige tu hueco"}</h2>

                <div className="visit">
                  <p className="visit__title">Tu cita: <b>{fmtDuration(totalDuration)}</b> · <b>{fmtPrice(totalPrice)}</b></p>
                  {visitServices.length > 1 && (
                    <div className="seg" role="radiogroup" aria-label="Cómo quieres tu visita">
                      <button type="button" role="radio" aria-checked={!apart} className={`seg__btn ${!apart ? "is-on" : ""}`} onClick={goTogether}>
                        <strong>Todo seguido</strong><small>Un solo bloque</small>
                      </button>
                      <button type="button" role="radio" aria-checked={apart} className={`seg__btn ${apart ? "is-on" : ""}`} onClick={goApart}>
                        <strong>Cada uno a su hora</strong><small>Días y horas distintos</small>
                      </button>
                    </div>
                  )}
                  {apart ? (
                    <ol className="legs">
                      {legs.map((l, i) => (
                        <li key={l.service.id} className={`leg ${i === activeLeg ? "is-active" : ""} ${l.hold ? "is-done" : ""}`}>
                          <button type="button" className="leg__main" onClick={() => selectLeg(i)} aria-current={i === activeLeg ? "step" : undefined}>
                            <span className="leg__n">{l.hold ? <Check size={14} aria-hidden="true" /> : i + 1}</span>
                            <span className="leg__txt">
                              <strong>{l.service.name} <small>{fmtDuration(l.service.durationMin)}</small></strong>
                              <em>{l.hold ? fmtLong(l.hold.startsAt) : i === activeLeg ? "Elige su hora aquí abajo" : "Toca para elegir su hora"}</em>
                            </span>
                          </button>
                          <button type="button" className="leg__x" onClick={() => removeService(l.service.id)} aria-label={`Quitar ${l.service.name}`}>Quitar</button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <ul className="visit__list">
                      {visitServices.map((x) => (
                        <li key={x.id}>
                          <span>{x.name} <small>{fmtDuration(x.durationMin)}</small></span>
                          {visitServices.length > 1 && <button type="button" onClick={() => removeService(x.id)} aria-label={`Quitar ${x.name}`}>Quitar</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {visitServices.length < 4 && (
                    <button type="button" className="visit__add" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen}>
                      {addOpen ? "Cerrar" : "＋ Añadir otro servicio a la misma visita"}
                    </button>
                  )}
                  {addOpen && (
                    <ul className="visit__pick">
                      {services.filter((x) => !visitServices.some((v) => v.id === x.id)).map((x) => (
                        <li key={x.id}>
                          <button type="button" onClick={() => addExtra(x)}>
                            <span>{x.name}<small>{fmtDuration(x.durationMin)}</small></span>
                            <b>{fmtPrice(x.priceCents)}</b>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

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
                    <div className="empty">
                      <p className="muted">No quedan huecos en {fmtMonth(month)}.</p>
                      {canNext && (
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => shiftMonth(1)}>
                          Ver {nextMonthLabel} <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {day && (
                  <div className="slots" aria-live="polite">
                    <h3 className="slots__day">{fmtDayLabel(day)}</h3>
                    {renderSlots("Mañana", morning)}
                    {renderSlots("Tarde", afternoon)}
                    <p className="legend">
                      <Lock size={12} aria-hidden="true" /> Ocupado o bloqueado por otra persona
                      {hold && <span className="legend__range"> · Tramo de tu cita: pulsa otra hora para moverla</span>}
                      {otherSpans.length > 0 && <span className="legend__yours"> · Coincide con tu otra cita</span>}
                    </p>
                  </div>
                )}

                {!hold && slots !== null && availServices.length > 0 && (
                  <WaitlistForm
                    key={`${availKey}-${day ?? "any"}`}
                    serviceId={availServices[0]?.id ?? service.id}
                    serviceIds={availServices.map((x) => x.id)}
                    day={day}
                    dayLabel={day ? fmtDayLabel(day) : undefined}
                    source="web"
                    startOpen={Object.keys(dayInfo).length === 0}
                  />
                )}

                <AnimatePresence>
                  {allHolds.length > 0 && (
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
                          {apart ? (
                            <>
                              <strong>{allHeld ? "Todas tus horas están guardadas" : `${allHolds.length} de ${legs.length} horas guardadas`}</strong>
                              {legs.length <= 3 && legs.filter((l) => l.hold).map((l) => <span key={l.service.id}>{l.service.name}: {fmtLong((l.hold as Hold).startsAt)}</span>)}
                            </>
                          ) : (
                            hold && (
                              <>
                                <strong>Hueco bloqueado para ti</strong>
                                <span>{fmtLong(hold.startsAt)}</span>
                                {hold.endsAt && <span>Ocupa de {fmtHM(hold.startsAt)} a {fmtHM(hold.endsAt)} ({fmtDuration(totalDuration)})</span>}
                              </>
                            )
                          )}
                        </div>
                        <span className="holdbar__time" aria-label={`Quedan ${mmss}`}>{mmss}</span>
                      </div>
                      <div className="holdbar__track" aria-hidden="true">
                        <i style={{ width: `${(remaining / holdTotalSec) * 100}%` }} />
                      </div>
                      {apart && !allHeld ? (
                        <button type="button" className="btn btn--primary btn--block" onClick={() => selectLeg(nextPendingIdx)}>
                          Ahora, la hora de {legs[nextPendingIdx]?.service.name}
                        </button>
                      ) : (
                        <button type="button" className="btn btn--primary btn--block" onClick={() => setStep("details")}>
                          Continuar
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* ---------------- DATOS ---------------- */}
            {step === "details" && allHeld && (
              <>
                <button type="button" className="back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> Cambiar hueco</button>
                <h2 className="panel__title">Tus datos</h2>
                <div className="holdmini" role="timer" aria-live="off">
                  <Clock size={15} aria-hidden="true" /> {apart ? "Tus huecos están guardados" : "Tu hueco está guardado"}: quedan <strong>{mmss}</strong>
                </div>
                {apart && (
                  <ul className="legsum" aria-label="Tus citas">
                    {legs.map((l) => (
                      <li key={l.service.id}><strong>{l.service.name}</strong><span>{l.hold ? fmtLong(l.hold.startsAt) : ""}</span></li>
                    ))}
                  </ul>
                )}
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
                    <span>Acepto que Pro Diva use mis datos para gestionar esta cita y enviarme la confirmación y un recordatorio por WhatsApp, SMS o email.</span>
                  </label>
                  {needsDeposit && (
                    <p className="notice notice--info">
                      Este servicio lleva una <b>señal de {fmtPrice(totalDeposit)}</b>, que se descuenta del total. Si cancelas con al menos {refundHours} h de antelación te la devolvemos; si no, se retiene. La pagas con tarjeta en el siguiente paso.
                    </p>
                  )}
                  <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={submitting}>
                    {submitting ? (needsDeposit ? "Abriendo el pago…" : "Confirmando…") : needsDeposit ? `Pagar señal de ${fmtPrice(totalDeposit)} y confirmar` : apart ? `Confirmar las ${legs.length} citas` : "Confirmar cita"}
                  </button>
                </form>
              </>
            )}

            {/* ---------------- LISTO ---------------- */}
            {step === "done" && done && doneAll.length > 0 && (
              <div className="done">
                <button type="button" className="back done__back" onClick={back}>
                  <ArrowLeft size={18} aria-hidden="true" /> Volver al menú
                </button>
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
                <h2 className="panel__title">{doneAll.length > 1 ? "¡Citas confirmadas!" : "¡Cita confirmada!"}</h2>
                <ul className="donelist">
                  {doneAll.map((d) => (
                    <li key={d.code}>
                      <p className="done__when">{fmtLong(d.startsAt)}</p>
                      <p className="muted">
                        {d.serviceName}
                        {multiStaff ? ` con ${d.staffName}` : ""} · {fmtPrice(d.priceCents)}
                      </p>
                      <p className="done__code">Código <strong>{d.code}</strong></p>
                    </li>
                  ))}
                </ul>
                <p className="muted">{address}</p>
                <div className="done__actions">
                  <a className="btn btn--primary" href={icsHref(doneAll, address)} download={`cita-prodiva-${done.code}.ics`}>
                    <CalendarPlus size={17} aria-hidden="true" /> Añadir al calendario
                  </a>
                  <a
                    className="btn btn--ghost"
                    href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, soy ${form.name}. He reservado ${doneAll.map((d) => `${d.serviceName} el ${fmtLong(d.startsAt)} (código ${d.code})`).join("; ")}.`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={17} aria-hidden="true" /> Avisar por WhatsApp
                  </a>
                  <Link className="btn btn--ghost" href={`/c/${done.code}?t=${done.token}`}>{doneAll.length > 1 ? "Ver, cambiar o cancelar mis citas" : "Ver, cambiar o cancelar mi cita"}</Link>
                </div>
                <button type="button" className="btn btn--primary btn--lg btn--block" onClick={reset}>Reservar otra cita</button>
                <Link className="back" href="/"><ArrowLeft size={16} aria-hidden="true" /> Volver al inicio de la web</Link>
                <p className="muted small">El mismo día te escribiremos para que confirmes con un toque. Guarda el enlace de arriba por si necesitas cancelar.</p>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      <div className="flow__side">
      {step !== "done" && (
        <aside className="summary" aria-label="Resumen de tu cita">
          <h2>Tu cita</h2>
          <dl>
            <dt>{apart ? "Tus citas" : "Servicio"}</dt>
            <dd>
              {apart ? (
                <ul className="summary__legs">
                  {legs.map((l) => (
                    <li key={l.service.id}><span>{l.service.name}</span><em>{l.hold ? fmtLong(l.hold.startsAt) : "sin hora"}</em></li>
                  ))}
                </ul>
              ) : visitServices.length ? visitServices.map((x) => x.name).join(" + ") : "Sin elegir"}
            </dd>
            {service && (
              <>
                <dt>Duración y precio</dt>
                <dd>{fmtDuration(totalDuration)} · {fmtPrice(totalPrice)}</dd>
              </>
            )}
            {needsDeposit && (
              <>
                <dt>Señal</dt>
                <dd>{fmtPrice(totalDeposit)} (se descuenta del total)</dd>
              </>
            )}
            {multiStaff && (
              <>
                <dt>Profesional</dt>
                <dd>{staffName ?? (step === "service" || step === "staff" ? "Sin elegir" : "La primera libre")}</dd>
              </>
            )}
            {!apart && (
              <>
                <dt>Fecha y hora</dt>
                <dd>{hold ? fmtLong(hold.startsAt) : "Sin elegir"}</dd>
              </>
            )}
          </dl>
          {allHolds.length > 0 && step !== "details" && <p className="summary__hold"><Lock size={13} aria-hidden="true" /> Bloqueado {mmss}</p>}
        </aside>
      )}
      <BookingAvatar
        state={avatarState}
        trends={trends}
        services={services}
        selected={visitServices.map((x) => x.slug)}
        step={step}
        address={address}
        onAdd={addFromAvatar}
      />
      </div>
    </div>
  );
}
