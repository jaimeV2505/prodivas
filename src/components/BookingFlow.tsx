"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Lock, MessageCircle, Sparkles } from "lucide-react";
import { discounted, matchPack, suggest } from "@/lib/combos";
import { colorFromNotes, dueRetouch, lastColor } from "@/lib/recs";
import { addDays, daysInMonth } from "@/lib/dates";
import { fmtDayLabel, fmtDuration, fmtHM, fmtLong, fmtMonth, fmtPrice, fmtShortDay, localParts, weekdayName, weekInitials } from "@/lib/format";
import { fill, getDict, LOCALE, type Dict } from "@/lib/i18n";
import { loadVisitHistory, saveBooking, saveVisitHistory, usualOf, type VisitRecord } from "@/lib/myBookings";
import { useStepHistory } from "@/lib/useStepHistory";
import { useLeadCapture } from "@/lib/useLead";
import { attribution, track } from "@/lib/track";
import type { Trend } from "@/lib/trends";
import BookingAvatar, { type AvatarState } from "./BookingAvatar";
import OtpField from "./OtpField";
import PetalBurst from "./PetalBurst";
import Quiz from "./Quiz";
import RebookCard from "./RebookCard";
import WaitlistForm from "./WaitlistForm";

export type Service = {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  depositCents?: number;
  depositAlways?: boolean;
  rebookWeeks?: number | null;
  /** Minutos de pose/espera que incluye (la profesional no está todo el rato; la clienta sí). */
  waitMin?: number;
  consentKind?: string | null;
};
export type Staff = { id: number; name: string };
/** Extra que suma tiempo y precio (retirada de esmalte, nail art…). */
export type Addon = { id: number; slug: string; name: string; description: string | null; durationMin: number; priceCents: number; category: string | null };
/** Pack: combinación de servicios ya pensada, con descuento opcional. */
export type Pack = { id: number; slug: string; name: string; emoji: string; description: string | null; serviceSlugs: string[]; discountPercent: number; occasion?: string | null; people?: number; featured?: boolean };
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
/** Visita en horas distintas: una cita por servicio, cada una con su día, su hora, su bloqueo y sus extras. */
type Leg = { service: Service; day: string | null; hold: Hold | null; addons: number[] };

type Props = {
  services: Service[];
  staff: Staff[];
  addons?: Addon[];
  packs?: Pack[];
  depositPolicy?: "service" | "repeat";
  initialSlug?: string;
  initialDay?: string;
  initialTime?: string;
  initialColor?: string;
  /** Profesional preseleccionada (enlace `?pro=`). */
  initialStaffId?: number;
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
const MAX_SERVICES = 6; // en un solo bloque (con acompañante)
const MAX_LEGS = 4; // citas separadas
const SAFETY_KINDS = ["laser", "microblading"] as const;

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

export default function BookingFlow({
  services,
  staff,
  addons = [],
  packs = [],
  depositPolicy = "service",
  initialSlug,
  initialDay,
  initialTime,
  initialColor,
  initialStaffId,
  initialExtras,
  trends = [],
  today,
  maxDate,
  whatsapp,
  address,
  depositEnabled = false,
  refundHours = 24,
}: Props) {
  const reduce = useReducedMotion();
  const T = getDict();
  const locale = LOCALE;
  const t = (k: keyof Dict, v?: Record<string, string | number>) => fill(T[k], v);
  const L = (x: { name: string; description?: string | null }) => ({ name: x.name, description: x.description ?? null });
  const money = (c: number) => fmtPrice(c);
  const weekInit = useMemo(() => weekInitials(locale), [locale]);

  const multiStaff = staff.length > 1;
  const stepOrder: Step[] = multiStaff ? ["service", "staff", "time", "details"] : ["service", "time", "details"];
  const stepLabel: Record<string, string> = { service: T.stepService, staff: T.stepStaff, time: T.stepTime, details: T.stepDetails };

  // Mensaje de error: el del servidor (más concreto) o uno genérico según el código
  const errText = (code: string | undefined, fallback: string, serverMsg?: string) => {
    if (serverMsg) return serverMsg;
    const map: Record<string, string> = { SLOT_TAKEN: T.errSlotTaken, HOLD_EXPIRED: T.errHoldExpired, NOT_FOUND: T.errNotFound, CONFLICT: T.errConflict, LIMIT: T.errLimit, INVALID: T.errInvalid };
    return (code && map[code]) || fallback;
  };

  const initialService = services.find((s) => s.slug === initialSlug) ?? null;
  const [service, setService] = useState<Service | null>(initialService);
  const [staffChoice, setStaffChoice] = useState<number | null>(initialStaffId && staff.some((x) => x.id === initialStaffId) ? initialStaffId : null); // null = cualquiera
  const [step, setStep] = useState<Step>(initialService ? (multiStaff && !initialTime && !(initialStaffId && staff.some((x) => x.id === initialStaffId)) ? "staff" : "time") : "service");
  const [month, setMonth] = useState((initialDay && initialDay >= today ? initialDay : today).slice(0, 7));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [soon, setSoon] = useState<Slot[] | null>(null); // próximas 3 semanas, para los atajos
  const [dayT, setDayT] = useState<string | null>(initialDay && initialDay >= today ? initialDay : null);
  const [holdT, setHoldT] = useState<Hold | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [now, setNow] = useState(0);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: initialColor ? `Color: ${initialColor}` : "", consent: false, website: "" });
  const [submitting, setSubmitting] = useState(false);
  // Quien ya reservó desde este móvil no vuelve a escribir sus datos (el mismo perfil que usa «Cita fácil»)
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("pd_profile") ?? "null") as { name?: string; phone?: string; staffId?: number } | null;
      if (p?.name || p?.phone) setForm((f) => ({ ...f, name: f.name || p.name || "", phone: f.phone || p.phone || "" }));
      const sid = Number((p as { staffId?: number } | null)?.staffId);
      if (sid && staff.some((x) => x.id === sid)) setHabitual(sid);
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  const [habitual, setHabitual] = useState<number | null>(null); // profesional de siempre (recordada en este móvil)
  const [otpAsk, setOtpAsk] = useState<{ devCode?: string } | null>(null); // el servidor pidió verificar el teléfono
  const [otp, setOtp] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [doneAll, setDoneAll] = useState<Done[]>([]);
  const [extras, setExtras] = useState<Service[]>(() =>
    (initialExtras ?? [])
      .map((slug) => services.find((x) => x.slug === slug))
      .filter((x): x is Service => !!x && x.id !== initialService?.id)
      .slice(0, MAX_SERVICES - 1),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [addonsT, setAddonsT] = useState<number[]>([]); // extras de la visita (en un bloque)
  const [history, setHistory] = useState<VisitRecord[]>([]);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  // Acompañante («venimos 2»): sus servicios van seguidos de los tuyos, en el mismo bloque
  const [compOpen, setCompOpen] = useState(false);
  const [compName, setCompName] = useState("");
  const [compDraft, setCompDraft] = useState<number[]>([]);
  const [compServices, setCompServices] = useState<Service[]>([]);
  const [twoPick, setTwoPick] = useState<Pack | null>(null); // pack «para dos»: pide el nombre de la acompañante
  const [twoName, setTwoName] = useState("");

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

  // Servicios de la visita (hasta 6 en un bloque, 4 en citas separadas) y los que se consultan ahora al pedir huecos
  const visitServices = useMemo(() => (apart ? legs.map((l) => l.service) : service ? [service, ...extras, ...compServices] : []), [apart, legs, service, extras, compServices]);
  const availServices = apart ? (cur ? [cur.service] : []) : visitServices;
  const curAddonIds = apart ? cur?.addons ?? [] : addonsT;
  // clave de lo que se consulta: servicios | extras
  // Medición anónima del embudo (nunca datos personales)
  const slugsKey = availServices.map((x) => x.slug).join(",");
  useEffect(() => {
    if (slugsKey && (step === "time" || step === "staff")) track("service", { flow: "full", services: slugsKey.split(",") });
  }, [slugsKey, step]);
  useEffect(() => {
    if (slugsKey && step === "time" && slots && slots.some((x) => x.available)) track("slots", { flow: "full", services: slugsKey.split(",") });
  }, [slugsKey, step, slots]);
  useEffect(() => {
    if (step === "details") track("details", { flow: "full", services: slugsKey.split(",") });
  }, [step, slugsKey]);
  const availKey = availServices.length ? `${availServices.map((x) => x.id).join(",")}|${curAddonIds.join(",")}` : "";
  const allAddonIds = apart ? legs.flatMap((l) => l.addons) : addonsT;
  const addonObjs = allAddonIds.map((id) => addons.find((a) => a.id === id)).filter((a): a is Addon => !!a);
  const servicesDuration = visitServices.reduce((a, x) => a + x.durationMin, 0);
  const totalDuration = servicesDuration + addonObjs.reduce((a, x) => a + x.durationMin, 0);
  // Pack: si los servicios elegidos son exactamente los de un pack, se aplica su descuento (el servidor comprueba lo mismo)
  const matchedPack = !apart ? matchPack(visitServices.map((s) => s.slug), packs) : null;
  const servicesPrice = visitServices.reduce((a, x) => a + x.priceCents, 0);
  const packPrice = matchedPack ? visitServices.reduce((a, x) => a + discounted(x.priceCents, matchedPack.discountPercent), 0) : servicesPrice;
  const packSaving = servicesPrice - packPrice;
  const totalPrice = packPrice + addonObjs.reduce((a, x) => a + x.priceCents, 0);
  // Señal: «según el servicio» como siempre, o solo a quien ya ha faltado (en ese caso solo cuentan los servicios marcados «siempre»)
  const depositKnown = visitServices.reduce((a, x) => a + (depositPolicy === "repeat" ? (x.depositAlways ? x.depositCents ?? 0 : 0) : x.depositCents ?? 0), 0);
  const needsDeposit = depositEnabled && depositKnown > 0;
  const showPolicyNote = depositEnabled && depositPolicy === "repeat";
  // Casillas de seguridad (láser, microblading)
  const kinds = SAFETY_KINDS.filter((k) => visitServices.some((s) => s.consentKind === k));
  const needAcks = kinds.flatMap((k) => [1, 2, 3].map((i) => `${k}:${i}`));
  const allAcked = needAcks.every((k) => acks[k]);

  /* ---------- disponibilidad ---------- */
  const refresh = useCallback(async (h?: Hold | null) => {
    if (!availKey) return;
    const [ids, ads] = availKey.split("|");
    const own = h === undefined ? holdRef.current : h; // el bloqueo propio no cuenta como "ocupado" para ella
    const from = `${month}-01`;
    const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
    const qs = new URLSearchParams({ serviceIds: ids, from, to });
    if (ads) qs.set("addonIds", ads);
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
      setNotice((n) => n ?? { tone: "error", text: T.loadFail });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Próximas 3 semanas (para «lo antes posible», «esta tarde» y «como siempre»), cada 30 s
  const fetchSoon = useCallback(async () => {
    if (!availKey) return;
    const [ids, ads] = availKey.split("|");
    const end = addDays(today, 20);
    const qs = new URLSearchParams({ serviceIds: ids, from: today, to: end > maxDate ? maxDate : end });
    if (ads) qs.set("addonIds", ads);
    if (staffChoice !== null) qs.set("staffId", String(staffChoice));
    const own = holdRef.current;
    if (own) {
      qs.set("holdId", own.holdId);
      qs.set("holdToken", own.holdToken);
    }
    try {
      const r = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      if (r.ok) setSoon(((await r.json()) as { slots: Slot[] }).slots);
    } catch {
      /* los atajos son un extra: sin conexión simplemente no salen */
    }
  }, [availKey, staffChoice, today, maxDate]);
  useEffect(() => {
    if (step !== "time" || !availKey) return;
    setSoon(null);
    void fetchSoon();
    const id = setInterval(() => void fetchSoon(), 30000);
    return () => clearInterval(id);
  }, [step, availKey, fetchSoon]);

  // Visitas anteriores guardadas en este móvil
  useEffect(() => {
    setHistory(loadVisitHistory());
  }, []);

  // Llegada desde un hueco del hero ("Hoy 17:15"): se bloquea solo y se pasa directo a los datos
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || !initialTime || !initialDay || !slots || !service || step !== "time") return;
    autoPicked.current = true;
    const target = slots.find((x) => x.day === initialDay && x.time === initialTime);
    if (target?.available) void pickSlot(target, true);
    else setNotice({ tone: "info", text: T.slotGone });
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
  const leadHold = apart ? legs.find((l) => l.hold)?.hold : holdT;
  useLeadCapture({ holdId: step === "details" ? leadHold?.holdId : undefined, holdToken: leadHold?.holdToken, phone: form.phone, name: form.name, flow: "full" });
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
      const nowMs = Date.now();
      setNow(nowMs);
      if (nowMs >= deadline) {
        clearAllHolds();
        setNotice({ tone: "info", text: T.timeUp });
        setStep((s) => (s === "details" ? "time" : s));
        void refresh(null);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          ...(staffChoice === null && habitual ? { preferStaffId: habitual } : {}),
          startsAt: slot.startsAt,
          ...(curAddonIds.length ? { addonIds: curAddonIds } : {}),
          ...(matchedPack ? { packageSlug: matchedPack.slug } : {}),
          ...(hold ? { replaceHoldId: hold.holdId, replaceToken: hold.holdToken } : {}),
          ...(siblings.length ? { extend: siblings.map((h) => ({ holdId: h.holdId, holdToken: h.holdToken })) } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setNotice({ tone: "error", text: errText(j?.error?.code, T.couldNotHold, j?.error?.message) });
        await refresh();
      } else {
        track("hold", { flow: "full", services: availServices.map((x) => x.slug), once: false });
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
          const lost = legs.filter((l, i) => i !== legIndex && l.hold && !ext.includes(l.hold.holdId)).map((l) => L(l.service).name);
          setLegs((ls) =>
            ls.map((l, i) => {
              if (i === legIndex) return { ...l, hold: next };
              if (!l.hold) return l;
              if (ext.includes(l.hold.holdId)) return { ...l, hold: { ...l.hold, deadline: deadlineNew, total: j.expiresInSec } };
              return { ...l, hold: null }; // ese bloqueo ya había caducado
            }),
          );
          if (lost.length) setNotice({ tone: "info", text: t("lostHold", { names: lost.join(" / ") }) });
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
      setNotice({ tone: "error", text: T.noConn });
    } finally {
      setBusySlot(null);
    }
  }

  /* ---------- navegación y acciones ---------- */
  // En horas distintas, el primer servicio de la lista es siempre `service` (se usa en varios sitios)
  function commitLegs(next: Leg[]) {
    setLegs(next);
    setService(next[0]?.service ?? null);
  }
  const names = (list: Service[]) => list.map((s) => L(s).name).join(" + ");
  const warnIfPackBreaks = (nextList: Service[]) => {
    if (matchedPack && !matchPack(nextList.map((s) => s.slug), packs)) setNotice({ tone: "info", text: t("packLost", { name: L(matchedPack).name }) });
    else setNotice(null);
  };

  // Añade varios servicios a la visita de golpe (packs, sugerencias, Diva)
  function addMany(list: Service[]): boolean {
    const cap = apart ? MAX_LEGS : MAX_SERVICES;
    const fresh = list.filter((s) => !visitServices.some((v) => v.id === s.id));
    if (!fresh.length) return false;
    if (visitServices.length + fresh.length > cap) return false;
    if (apart) {
      commitLegs([...legs, ...fresh.map((s) => ({ service: s, day: null, hold: null, addons: [] as number[] }))]); // las demás citas conservan su hueco
    } else {
      dropHold();
      setExtras((e) => [...e, ...fresh]);
    }
    setSlots(null);
    setAddOpen(false);
    setNotice(null);
    return true;
  }
  function addExtra(s: Service) {
    if (!addMany([s])) return;
    warnIfPackBreaks([...visitServices, s]);
  }
  // Quita un servicio de la lista (por posición: el mismo servicio puede estar dos veces, para ti y para tu acompañante)
  function removeAt(i: number) {
    if (visitServices.length < 2) return;
    const next = visitServices.filter((_, k) => k !== i);
    if (apart) {
      const gone = legs[i];
      if (!gone) return;
      if (gone.hold) void release(gone.hold);
      const rest = legs.filter((_, k) => k !== i);
      if (rest.length === 1) {
        // queda una sola cita: vuelve a «todo seguido» conservando su hueco
        const only = rest[0];
        setApart(false);
        setLegs([]);
        setActiveLeg(0);
        setService(only.service);
        setExtras([]);
        setAddonsT(only.addons);
        setHoldT(only.hold);
        setDayT(only.day);
      } else {
        commitLegs(rest);
        setActiveLeg(Math.min(activeLeg > i ? activeLeg - 1 : activeLeg, rest.length - 1));
      }
    } else {
      dropHold();
      const ownCount = 1 + extras.length;
      if (i >= ownCount) {
        const rest = compServices.filter((_, k) => k !== i - ownCount);
        setCompServices(rest);
        if (!rest.length) setCompName("");
      } else if (i === 0) {
        const [first, ...rest] = extras;
        if (first) {
          setService(first);
          setExtras(rest);
        }
      } else {
        setExtras((e) => e.filter((_, k) => k !== i - 1));
      }
    }
    setSlots(null);
    warnIfPackBreaks(next);
  }
  // «Todo seguido» ⇄ «Cada uno a su hora»
  function goApart() {
    if (visitServices.length < 2 || visitServices.length > MAX_LEGS || compServices.length) return;
    dropHold();
    const ls: Leg[] = visitServices.map((s) => ({ service: s, day: null, hold: null, addons: [] }));
    for (const id of addonsT) {
      const a = addons.find((x) => x.id === id);
      const li = ls.findIndex((l) => !a?.category || l.service.category === a.category);
      if (li >= 0) ls[li].addons.push(id);
    }
    setLegs(ls);
    setActiveLeg(0);
    setApart(true);
    setSlots(null);
    setNotice(null);
  }
  function goTogether() {
    const sv = legs.map((l) => l.service);
    const ad = Array.from(new Set(legs.flatMap((l) => l.addons)));
    dropHold();
    setApart(false);
    setLegs([]);
    setActiveLeg(0);
    setService(sv[0] ?? null);
    setExtras(sv.slice(1));
    setAddonsT(ad);
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
  // Empezar con una lista de servicios (un pack, «repetir lo de la última vez»…)
  function chooseVisit(list: Service[], opts: { comp?: { name: string; services: Service[] }; addonSlugs?: string[] } = {}) {
    if (!list.length) return;
    dropHold();
    setApart(false);
    setLegs([]);
    setActiveLeg(0);
    setService(list[0]);
    setExtras(list.slice(1, MAX_SERVICES));
    // extras sugeridos (p. ej. nail art en el test): solo los que existen y encajan con algún servicio
    setAddonsT((opts.addonSlugs ?? []).map((sl) => addons.find((a) => a.slug === sl)).filter((a): a is Addon => !!a && (!a.category || list.some((x) => x.category === a.category))).map((a) => a.id));
    setCompServices(opts.comp?.services ?? []);
    setCompName(opts.comp?.name ?? "");
    setCompDraft([]);
    setCompOpen(false);
    setTwoPick(null);
    setAddOpen(false);
    setSlots(null);
    setDayT(null);
    setNotice(null);
    setStep(multiStaff ? "staff" : "time");
  }
  const chooseService = (s: Service) => chooseVisit([s]);
  const packServices = (p: Pack) => p.serviceSlugs.map((slug) => services.find((x) => x.slug === slug)).filter((x): x is Service => !!x);
  function choosePack(p: Pack) {
    const sv = packServices(p);
    if (sv.length !== p.serviceSlugs.length) return;
    if (p.people === 2) {
      setTwoPick(p); // primero el nombre de la acompañante
      return;
    }
    chooseVisit(sv);
  }
  // Pack «para dos»: los servicios del pack son tuyos y, a continuación, los mismos para tu acompañante
  function choosePackTwo(p: Pack, name: string) {
    const sv = packServices(p);
    if (sv.length !== p.serviceSlugs.length || name.trim().length < 2) return;
    chooseVisit(sv, { comp: { name: name.trim(), services: sv } });
  }
  function chooseStaff(id: number | null) {
    dropHold();
    setStaffChoice(id);
    setSlots(null);
    setDayT(null);
    setLegs((ls) => ls.map((l) => ({ ...l, day: null })));
    setNotice(null);
    setStep("time");
  }
  // Extras: suman tiempo y precio, así que el hueco guardado se libera y se vuelve a elegir
  function toggleAddon(id: number) {
    setNotice(null);
    if (apart) {
      const leg = legs[activeLeg];
      if (!leg) return;
      if (leg.hold) void release(leg.hold);
      setLegs((ls) => ls.map((l, i) => (i === activeLeg ? { ...l, hold: null, addons: l.addons.includes(id) ? l.addons.filter((x) => x !== id) : [...l.addons, id] } : l)));
    } else {
      dropHold();
      setAddonsT((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
    }
    setSlots(null);
  }
  // Acompañante: sus servicios van detrás de los tuyos, en el mismo bloque
  function toggleCompDraft(id: number) {
    setCompDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  }
  function addCompanion() {
    const picked = compDraft.map((id) => services.find((s) => s.id === id)).filter((s): s is Service => !!s);
    if (compName.trim().length < 2 || !picked.length) {
      setNotice({ tone: "error", text: T.companionNeedName });
      return;
    }
    if (visitServices.length + picked.length > MAX_SERVICES) {
      setNotice({ tone: "error", text: T.divaFull });
      return;
    }
    dropHold();
    setCompServices(picked);
    setCompOpen(false);
    setSlots(null);
    warnIfPackBreaks([...visitServices, ...picked]);
  }
  function removeCompanion() {
    dropHold();
    setCompServices([]);
    setCompName("");
    setCompDraft([]);
    setSlots(null);
    warnIfPackBreaks(visitServices.slice(0, 1 + extras.length));
  }
  // Atajos: coge el hueco y lo bloquea en un toque
  async function pickShortcut(slot: Slot) {
    setMonth(slot.day.slice(0, 7));
    setDay(slot.day);
    await pickSlot(slot);
  }
  // Nueva cita: se conservan nombre, teléfono y email para no escribirlos otra vez
  function reset() {
    dropHold();
    setApart(false);
    setLegs([]);
    setActiveLeg(0);
    setService(null);
    setExtras([]);
    setAddonsT([]);
    setCompServices([]);
    setCompName("");
    setCompDraft([]);
    setCompOpen(false);
    setAcks({});
    setAddOpen(false);
    setStaffChoice(null);
    setSlots(null);
    setDayT(null);
    setDone(null);
    setDoneAll([]);
    setNotice(null);
    setForm((f) => ({ ...f, notes: "" }));
    setHistory(loadVisitHistory());
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

  // Desde Diva: añadir un servicio (o un pack entero) con un toque
  function addFromAvatar(slug: string, kind: "service" | "pack" = "service"): "added" | "chosen" | "already" | "full" | "missing" {
    if (kind === "pack") {
      const p = packs.find((x) => x.slug === slug);
      if (!p) return "missing";
      const sv = packServices(p);
      if (sv.length !== p.serviceSlugs.length) return "missing";
      if (step === "service" || !service) {
        chooseVisit(sv);
        return "chosen";
      }
      if (step === "done" || step === "details") return "missing";
      if (sv.every((s) => visitServices.some((v) => v.id === s.id))) return "already";
      return addMany(sv) ? "added" : "full";
    }
    const s = services.find((x) => x.slug === slug);
    if (!s) return "missing";
    if (visitServices.some((v) => v.id === s.id)) return "already";
    if (step === "service" || !service) {
      chooseService(s);
      return "chosen";
    }
    if (step === "done" || step === "details") return "missing";
    if (visitServices.length >= (apart ? MAX_LEGS : MAX_SERVICES)) return "full";
    addExtra(s);
    return "added";
  }

  // Los comentarios para el salón (en castellano) llevan al acompañante y sus servicios
  function composeNotes(): string {
    const own = form.notes.trim();
    if (!compServices.length || !compName.trim()) return own;
    const line = fill(getDict().companionNote, { name: compName.trim(), services: compServices.map((s) => s.name).join(" + ") });
    return (own ? `${line}\n${own}` : line).slice(0, 500);
  }

  /* ---------- confirmar ---------- */
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !allHeld || !allAcked) return;
    setSubmitting(true);
    setNotice(null);
    const who = {
      name: form.name,
      phone: form.phone,
      email: form.email,
      notes: composeNotes(),
      website: form.website,
      ...(kinds.length ? { acks: [...kinds] } : {}),
      ...(otpAsk && otp.length === 6 ? { otp } : {}),
      attr: { ...attribution(), flow: "full" },
    };
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
        if (code === "VERIFY") {
          // El teléfono es nuevo: se pide el código que acaba de llegar (los huecos siguen guardados)
          setOtpAsk({ devCode: j?.error?.data?.devCode as string | undefined });
          if (j?.error?.data?.wrong) setOtp("");
          setNotice({ tone: "info", text: j?.error?.message ?? "Escribe el código que te hemos enviado." });
          return;
        }
        setNotice({ tone: "error", text: errText(code, T.couldNotConfirm, j?.error?.message) });
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
      for (const b of list) {
        saveBooking(b.code, b.token);
        saveVisitHistory({ startsAt: b.startsAt, slugs: services.filter((s) => b.serviceName.includes(s.name)).map((s) => s.slug), color: colorFromNotes(form.notes) });
      }
      try {
        localStorage.setItem("pd_profile", JSON.stringify({ name: form.name, phone: form.phone, staffId: (list[0] as { staffId?: number }).staffId ?? habitual ?? undefined, slug: availServices[0]?.slug ?? "", serviceName: list[0].serviceName, slugs: services.filter((x) => list[0].serviceName.includes(x.name)).map((x) => x.slug) }));
      } catch {
        /* nada */
      }
      allHoldsRef.current = [];
      holdRef.current = null;
      setDoneAll(list);
      setDone(list[0]);
      clearAllHolds(); // confirmadas: no hay nada que liberar
      setStep("done");
    } catch {
      setNotice({ tone: "error", text: T.noConnConfirm });
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
  const curAddonDur = curAddonIds.reduce((a, id) => a + (addons.find((x) => x.id === id)?.durationMin ?? 0), 0);
  // Si van en horas distintas, el tramo de las otras citas se marca para no solaparlas
  const otherSpans = apart ? legs.flatMap((l, i) => (i !== activeLeg && l.hold ? [{ start: new Date(l.hold.startsAt).getTime(), end: new Date(l.hold.endsAt).getTime(), name: L(l.service).name }] : [])) : [];
  const curDurMs = ((availServices[0]?.durationMin ?? 0) + curAddonDur) * 60000;
  const nextMonthLabel = fmtMonth(new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 7), locale);
  const staffName = hold?.staffName ?? (staffChoice ? staff.find((s) => s.id === staffChoice)?.name : null);
  const stepIndex = stepOrder.indexOf(step);
  const eligibleAddons = addons.filter((a) => !a.category || availServices.some((s) => s.category === a.category));
  const lastSlugs = history.length ? history[history.length - 1].slugs : [];
  const retouchNow = history.length ? dueRetouch(history, services, Date.now())[0] : undefined;
  const retouchSvc = retouchNow ? services.find((x) => x.slug === retouchNow.slug) : undefined;
  const colorLast = lastColor(history);
  const lastServices = lastSlugs.map((slug) => services.find((s) => s.slug === slug)).filter((s): s is Service => !!s);
  const suggestions = useMemo(
    () => (apart ? [] : suggest({ have: visitServices.map((s) => s.slug), catalog: services.map((s) => s.slug), packs, maxServices: MAX_SERVICES, max: 3 })),
    [apart, visitServices, services, packs],
  );
  const packOf = (slug: string) => packs.find((p) => p.slug === slug);

  // Atajos: «lo antes posible», «esta tarde» y «como siempre» (según tus visitas anteriores en este móvil)
  const tomorrow = addDays(today, 1);
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const whenLabel = (s: Slot) => `${s.day === today ? T.today : s.day === tomorrow ? T.tomorrow : fmtShortDay(s.day, locale)} · ${s.time}`;
  const quick = useMemo(() => {
    const out: { key: string; label: string; when: string; hint?: string; slot: Slot }[] = [];
    if (!soon) return out;
    const free = soon.filter((s) => s.available).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const first = free[0];
    if (first) out.push({ key: "soon", label: T.soonest, when: whenLabel(first), slot: first });
    const aft = free.find((s) => Number(s.time.slice(0, 2)) >= 15);
    if (aft && aft.startsAt !== first?.startsAt) {
      const label = aft.day === today ? T.thisAfternoon : aft.day === tomorrow ? T.tomorrowAfternoon : `${fmtShortDay(aft.day, locale)} · ${T.afternoon.toLowerCase()}`;
      out.push({ key: "aft", label, when: whenLabel(aft), slot: aft });
    }
    const usual = usualOf(history);
    if (usual) {
      const near = free
        .map((s) => ({ s, p: localParts(s.startsAt) }))
        .filter((x) => x.p.dow === usual.dow && Math.abs(x.p.minutes - usual.minutes) <= 45)
        .sort((a, b) => (a.p.day === b.p.day ? Math.abs(a.p.minutes - usual.minutes) - Math.abs(b.p.minutes - usual.minutes) : a.p.day < b.p.day ? -1 : 1))[0];
      if (near && near.s.startsAt !== first?.startsAt) {
        out.push({ key: "usual", label: T.asUsual, when: whenLabel(near.s), hint: t("asUsualHint", { weekday: weekdayName(usual.dow, locale), time: hm(usual.minutes) }), slot: near.s });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soon, history, today]);

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
                title={clash ? t("slotClashTitle", { name: clash.name }) : range && hold ? t("slotRangeTitle", { from: fmtHM(hold.startsAt), to: fmtHM(hold.endsAt) }) : undefined}
                disabled={taken || !!clash || busySlot === s.startsAt}
                aria-pressed={mine}
                aria-label={clash ? t("slotClash", { time: s.time, name: clash.name }) : taken ? t("slotTaken", { time: s.time }) : mine ? t("slotMine", { time: s.time }) : range ? t("slotRange", { time: s.time }) : s.time}
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
          <ol className="progress" aria-label={T.progress}>
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
                <Link href="/" className="back"><ArrowLeft size={16} aria-hidden="true" /> {T.backHome}</Link>
                <h2 className="panel__title">{T.whatDoWeDo}</h2>
                {retouchSvc && retouchNow && (
                  <div className="retouch" role="note">
                    <p>⏰ {t("retouchDue", { weeks: retouchNow.weeks, service: L(retouchSvc).name })}{colorLast ? ` ${t("lastColor", { color: colorLast })}` : ""}</p>
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => chooseVisit([retouchSvc])}>{T.retouchBtn}</button>
                  </div>
                )}
                {lastServices.length > 0 && (
                  <button type="button" className="repeat" onClick={() => chooseVisit(lastServices)}>
                    <span className="repeat__ico">🔁</span>
                    <span><strong>{T.repeatLast}</strong><small>{names(lastServices)}</small></span>
                  </button>
                )}
                <Quiz
                  catalog={services.map((x) => x.slug)}
                  addonSlugs={addons.map((x) => x.slug)}
                  onPick={(slugs, addonSlug) => chooseVisit(slugs.map((sl) => services.find((x) => x.slug === sl)).filter((x): x is Service => !!x), { addonSlugs: addonSlug ? [addonSlug] : [] })}
                />
                {packs.length > 0 && (
                  <div className="packs">
                    <h3>🎁 {T.packsTitle}</h3>
                    <p className="muted small">{T.packsSub}</p>
                    <ul className="pack-list">
                      {packs.map((p) => {
                        const sv = packServices(p);
                        if (sv.length !== p.serviceSlugs.length) return null; // algún servicio del pack ya no está disponible
                        const k = p.people === 2 ? 2 : 1; // «para dos»: todo se hace dos veces
                        const full = k * sv.reduce((a, s) => a + s.priceCents, 0);
                        const price = k * sv.reduce((a, s) => a + discounted(s.priceCents, p.discountPercent), 0);
                        const lp = L(p);
                        const occ = p.occasion ?? null;
                        return (
                          <li key={p.id}>
                            <button type="button" className={`pack ${p.featured ? "pack--featured" : ""}`} onClick={() => choosePack(p)} aria-label={`${lp.name}: ${T.packPick}`}>
                              <span className="pack__emoji" aria-hidden="true">{p.emoji}</span>
                              <span className="pack__main">
                                {(p.featured || occ || p.people === 2) && (
                                  <span className="pack__tags">
                                    {p.featured && <span className="pack__tag pack__tag--star">{T.packFeatured}</span>}
                                    {occ && <span className="pack__tag">{occ}</span>}
                                    {p.people === 2 && <span className="pack__tag">{T.packFor2Tag}</span>}
                                  </span>
                                )}
                                <strong>{lp.name}</strong>
                                {lp.description && <small>{lp.description}</small>}
                                <em>{names(sv)}{k === 2 ? " ×2" : ""}</em>
                              </span>
                              <span className="pack__meta">
                                <b>{fmtDuration(k * sv.reduce((a, s) => a + s.durationMin, 0))}</b>
                                {p.discountPercent > 0 ? (
                                  <>
                                    <s>{money(full)}</s>
                                    <b className="pack__price">{money(price)}</b>
                                    <span className="pack__save">{t("packSave", { percent: p.discountPercent })}</span>
                                  </>
                                ) : (
                                  <b className="pack__price">{money(full)}</b>
                                )}
                              </span>
                            </button>
                            {twoPick?.id === p.id && (
                              <form className="pack-two" onSubmit={(e) => { e.preventDefault(); choosePackTwo(p, twoName); }}>
                                <label className="field">
                                  <span>{T.packTwoName}</span>
                                  <input required minLength={2} maxLength={40} value={twoName} onChange={(e) => setTwoName(e.target.value)} autoComplete="off" />
                                </label>
                                <p className="muted small">{T.packTwoSub}</p>
                                <div className="pack-two__row">
                                  <button type="submit" className="btn btn--primary btn--sm">{T.packTwoGo}</button>
                                  <button type="button" className="resp__link" onClick={() => setTwoPick(null)}>{T.close}</button>
                                </div>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {groups.map((g) => (
                  <div key={g.category} className="pick-group">
                    <h3>{g.category}</h3>
                    <ul className="pick-list">
                      {g.items.map((s) => (
                        <li key={s.id}>
                          <button type="button" className={`pick ${service?.id === s.id ? "is-on" : ""}`} style={{ ["--i" as string]: Math.min(order.get(s.id) ?? 0, 6) } as React.CSSProperties} onClick={() => chooseService(s)}>
                            <span className="pick__main">
                              <strong>{L(s).name}</strong>
                              {L(s).description && <small>{L(s).description}</small>}
                            </span>
                            <span className="pick__meta">{fmtDuration(s.durationMin)}{s.waitMin ? ` · incluye ${s.waitMin} min de pose` : ""}</span>
                            <span className="pick__price">{money(s.priceCents)}</span>
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
                <button type="button" className="back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> {T.changeService}</button>
                <h2 className="panel__title">{T.withWho}</h2>
                <ul className="pick-list">
                  {habitual && staff.find((x) => x.id === habitual) && (
                    <li>
                      <button type="button" className={`pick pick--star ${staffChoice === habitual ? "is-on" : ""}`} onClick={() => chooseStaff(habitual)}>
                        <span className="pick__main">
                          <strong>Con {staff.find((x) => x.id === habitual)!.name}, como siempre</strong>
                          <small>Tu profesional de la última vez</small>
                        </span>
                        <Sparkles size={18} aria-hidden="true" />
                      </button>
                    </li>
                  )}
                  <li>
                    <button type="button" className={`pick ${staffChoice === null ? "is-on" : ""}`} onClick={() => chooseStaff(null)}>
                      <span className="pick__main">
                        <strong>{T.firstFree}</strong>
                        <small>{T.moreSlots}</small>
                      </span>
                      <Sparkles size={18} aria-hidden="true" />
                    </button>
                  </li>
                  {staff.filter((s) => s.id !== habitual).map((s) => (
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
                  <ArrowLeft size={16} aria-hidden="true" /> {multiStaff ? T.changeStaff : T.changeService}
                </button>
                <h2 className="panel__title">{apart && cur ? t("chooseSlotFor", { name: L(cur.service).name }) : T.chooseSlot}</h2>

                <div className="visit">
                  <p className="visit__title">{T.yourVisit}: <b>{fmtDuration(totalDuration)}</b>{visitServices.some((x) => x.waitMin) ? ` (incluye ${visitServices.reduce((a, x) => a + (x.waitMin ?? 0), 0)} min de pose)` : ""} · <b>{money(totalPrice)}</b></p>
                  {matchedPack && (
                    <p className="visit__pack">{matchedPack.emoji} {packSaving > 0 ? t("packSavedLine", { name: L(matchedPack).name, amount: money(packSaving) }) : t("packBadge", { name: L(matchedPack).name })}</p>
                  )}
                  {visitServices.length > 1 && visitServices.length <= MAX_LEGS && !compServices.length && (
                    <div className="seg" role="radiogroup" aria-label={T.howVisit}>
                      <button type="button" role="radio" aria-checked={!apart} className={`seg__btn ${!apart ? "is-on" : ""}`} onClick={goTogether}>
                        <strong>{T.allTogether}</strong><small>{T.oneBlock}</small>
                      </button>
                      <button type="button" role="radio" aria-checked={apart} className={`seg__btn ${apart ? "is-on" : ""}`} onClick={goApart}>
                        <strong>{T.eachOwn}</strong><small>{T.differentDays}</small>
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
                              <strong>{L(l.service).name} <small>{fmtDuration(l.service.durationMin)}</small></strong>
                              <em>{l.hold ? fmtLong(l.hold.startsAt, locale) : i === activeLeg ? T.pickTimeBelow : T.tapToPick}</em>
                            </span>
                          </button>
                          <button type="button" className="leg__x" onClick={() => removeAt(i)} aria-label={t("removeX", { name: L(l.service).name })}>{T.remove}</button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <ul className="visit__list">
                      {visitServices.map((x, i) => (
                        <li key={`${x.id}-${i}`}>
                          <span>
                            {L(x).name} <small>{fmtDuration(x.durationMin)}</small>
                            {i >= 1 + extras.length && <em className="visit__for"> · {t("companionOf", { name: compName })}</em>}
                          </span>
                          {visitServices.length > 1 && <button type="button" onClick={() => removeAt(i)} aria-label={t("removeX", { name: L(x).name })}>{T.remove}</button>}
                        </li>
                      ))}
                    </ul>
                  )}

                  {suggestions.length > 0 && (
                    <div className="sugg" aria-label={T.suggestTitle}>
                      <p className="sugg__title">✨ {T.suggestTitle}</p>
                      <div className="sugg__row">
                        {suggestions.map((sg) => {
                          const sv = sg.add.map((slug) => services.find((s) => s.slug === slug)).filter((s): s is Service => !!s);
                          const pk = sg.kind === "pack" ? packOf(sg.packSlug) : undefined;
                          const reason = sg.kind === "pack" && pk ? (sg.percent > 0 ? t("suggestCompletesSave", { pack: L(pk).name, percent: sg.percent }) : t("suggestCompletes", { pack: L(pk).name })) : sg.kind === "pair" ? T[sg.reason] : "";
                          return (
                            <button key={sg.key} type="button" className="sugg__chip" onClick={() => { addMany(sv); }}>
                              <strong>{t("suggestAdd", { name: names(sv) })}</strong>
                              <small>{reason}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {eligibleAddons.length > 0 && (
                    <div className="extras">
                      <p className="extras__title">{T.extrasTitle}</p>
                      <div className="extras__row">
                        {eligibleAddons.map((a) => {
                          const on = curAddonIds.includes(a.id);
                          return (
                            <button key={a.id} type="button" className={`extra ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => toggleAddon(a.id)} title={L(a).description ?? undefined}>
                              <span className="extra__box" aria-hidden="true">{on ? <Check size={12} /> : "+"}</span>
                              <span><strong>{L(a).name}</strong><small>{t("extraLine", { dur: fmtDuration(a.durationMin), price: money(a.priceCents) })}</small></span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {visitServices.length < (apart ? MAX_LEGS : MAX_SERVICES) && (
                    <button type="button" className="visit__add" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen}>
                      {addOpen ? T.close : T.addService}
                    </button>
                  )}
                  {addOpen && (
                    <ul className="visit__pick">
                      {services.filter((x) => !visitServices.some((v) => v.id === x.id)).map((x) => (
                        <li key={x.id}>
                          <button type="button" onClick={() => addExtra(x)}>
                            <span>{L(x).name}<small>{fmtDuration(x.durationMin)}</small></span>
                            <b>{money(x.priceCents)}</b>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!apart && (
                    <div className="comp">
                      {compServices.length ? (
                        <div className="comp__sum">
                          <span>👯 {t("companionOf", { name: compName })}: <b>{names(compServices)}</b></span>
                          <button type="button" className="comp__x" onClick={removeCompanion}>{T.companionRemove}</button>
                        </div>
                      ) : (
                        <>
                          <button type="button" className="visit__add comp__open" onClick={() => setCompOpen((o) => !o)} aria-expanded={compOpen}>
                            👯 {T.companionTitle}
                          </button>
                          {compOpen && (
                            <div className="comp__form">
                              <p className="muted small">{T.companionSub}</p>
                              <label className="field">
                                <span>{T.companionName}</span>
                                <input value={compName} onChange={(e) => setCompName(e.target.value)} maxLength={40} autoComplete="off" />
                              </label>
                              <p className="comp__pick">{T.companionPick}</p>
                              <div className="comp__list">
                                {services.map((s) => {
                                  const on = compDraft.includes(s.id);
                                  return (
                                    <button key={s.id} type="button" className={`extra ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => toggleCompDraft(s.id)}>
                                      <span className="extra__box" aria-hidden="true">{on ? <Check size={12} /> : "+"}</span>
                                      <span><strong>{L(s).name}</strong><small>{fmtDuration(s.durationMin)} · {money(s.priceCents)}</small></span>
                                    </button>
                                  );
                                })}
                              </div>
                              <button type="button" className="btn btn--primary btn--sm" onClick={addCompanion}>{T.companionAdd}</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {quick.length > 0 && (
                  <div className="quick" aria-label={T.quickTitle}>
                    <p className="quick__title">⚡ {T.quickTitle}</p>
                    <div className="quick__row">
                      {quick.map((q) => (
                        <button key={q.key} type="button" className="quick__chip" title={q.hint} onClick={() => void pickShortcut(q.slot)} disabled={!!busySlot}>
                          <strong>{q.label}</strong>
                          <small>{q.when}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="cal" aria-label={T.calendar}>
                  <div className="cal__head">
                    <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} disabled={!canPrev} aria-label={T.prevMonth}>
                      <ChevronLeft size={18} aria-hidden="true" />
                    </button>
                    <strong aria-live="polite">{fmtMonth(month, locale)}</strong>
                    <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} disabled={!canNext} aria-label={T.nextMonth}>
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="cal__grid" role="grid">
                    {weekInit.map((w, i) => (
                      <span key={i} className="cal__wd" role="columnheader">{w}</span>
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
                          aria-label={`${fmtDayLabel(ds, locale)}${free ? "" : full ? T.dayFull : T.dayNone}`}
                          aria-pressed={sel}
                          onClick={() => setDay(ds)}
                        >
                          <span className="cal__n">{i + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                  {slots === null && <p className="muted" aria-live="polite">{T.loadingSlots}</p>}
                  {slots !== null && Object.keys(dayInfo).length === 0 && (
                    <div className="empty">
                      <p className="muted">{t("noSlotsMonth", { month: fmtMonth(month, locale) })}</p>
                      {staffChoice !== null && (
                        <p>
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => chooseStaff(null)}>
                            Ver huecos con cualquier profesional
                          </button>
                        </p>
                      )}
                      {canNext && (
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => shiftMonth(1)}>
                          {t("seeMonth", { month: nextMonthLabel })} <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {day && (
                  <div className="slots" aria-live="polite">
                    <h3 className="slots__day">{fmtDayLabel(day, locale)}</h3>
                    {renderSlots(T.morning, morning)}
                    {renderSlots(T.afternoon, afternoon)}
                    <p className="legend">
                      <Lock size={12} aria-hidden="true" /> {T.legendTaken}
                      {hold && <span className="legend__range"> · {T.legendRange}</span>}
                      {otherSpans.length > 0 && <span className="legend__yours"> · {T.legendClash}</span>}
                    </p>
                  </div>
                )}

                {!hold && slots !== null && availServices.length > 0 && (
                  <WaitlistForm
                    key={`${availKey}-${day ?? "any"}`}
                    serviceId={availServices[0]?.id ?? service.id}
                    serviceIds={availServices.map((x) => x.id)}
                    day={day}
                    dayLabel={day ? fmtDayLabel(day, locale) : undefined}
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
                              <strong>{allHeld ? T.holdsAll : t("holdsSome", { n: allHolds.length, total: legs.length })}</strong>
                              {legs.length <= 3 && legs.filter((l) => l.hold).map((l) => <span key={l.service.id}>{L(l.service).name}: {fmtLong((l.hold as Hold).startsAt, locale)}</span>)}
                            </>
                          ) : (
                            hold && (
                              <>
                                <strong>{T.holdTitle}</strong>
                                <span>{fmtLong(hold.startsAt, locale)}</span>
                                {hold.endsAt && <span>{t("holdOccupies", { from: fmtHM(hold.startsAt), to: fmtHM(hold.endsAt), dur: fmtDuration(totalDuration) })}</span>}
                              </>
                            )
                          )}
                        </div>
                        <span className="holdbar__time" aria-label={t("timeLeft", { t: mmss })}>{mmss}</span>
                      </div>
                      <div className="holdbar__track" aria-hidden="true">
                        <i style={{ width: `${(remaining / holdTotalSec) * 100}%` }} />
                      </div>
                      {apart && !allHeld ? (
                        <button type="button" className="btn btn--primary btn--block" onClick={() => selectLeg(nextPendingIdx)}>
                          {t("holdNext", { name: nextPendingIdx >= 0 ? L(legs[nextPendingIdx].service).name : "" })}
                        </button>
                      ) : (
                        <button type="button" className="btn btn--primary btn--block" onClick={() => setStep("details")}>
                          {T.continue}
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
                <button type="button" className="back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> {T.changeSlot}</button>
                <h2 className="panel__title">{T.yourData}</h2>
                <div className="holdmini" role="timer" aria-live="off">
                  <Clock size={15} aria-hidden="true" /> {apart ? T.holdMiniMany : T.holdMiniOne}: {T.remaining} <strong>{mmss}</strong>
                </div>
                {apart && (
                  <ul className="legsum" aria-label={T.yourAppointments}>
                    {legs.map((l) => (
                      <li key={l.service.id}><strong>{L(l.service).name}</strong><span>{l.hold ? fmtLong(l.hold.startsAt, locale) : ""}</span></li>
                    ))}
                  </ul>
                )}
                <form onSubmit={submit} className="form" noValidate={false}>
                  <label className="field">
                    <span>{T.name}</span>
                    <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
                  </label>
                  <label className="field">
                    <span>{T.phone}</span>
                    <input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => { setOtpAsk(null); setOtp(""); setForm({ ...form, phone: e.target.value }); }} placeholder="600 123 456" />
                    <small className="muted">Te guardamos el hueco. Si no terminas, te escribimos una sola vez por si quieres retomarlo.</small>
                  </label>
                  {otpAsk && <OtpField value={otp} onChange={setOtp} devCode={otpAsk.devCode} phone={form.phone} />}
                  <label className="field">
                    <span>{T.email} <em>{T.optionalConfirmation}</em></span>
                    <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>{T.comments} <em>{T.optional}</em></span>
                    <textarea rows={3} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={T.commentsPh} />
                  </label>
                  {/* honeypot */}
                  <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />

                  {kinds.length > 0 && (
                    <fieldset className="safety">
                      <legend>{T.safetyTitle}</legend>
                      {kinds.map((k) => (
                        <div key={k} className="safety__group">
                          <h4>{T[`${k}Title` as keyof Dict]}</h4>
                          {[1, 2, 3].map((i) => (
                            <label key={i} className="check">
                              <input type="checkbox" required checked={!!acks[`${k}:${i}`]} onChange={(e) => setAcks({ ...acks, [`${k}:${i}`]: e.target.checked })} />
                              <span>{T[`${k}${i}` as keyof Dict]}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                      <p className="muted small">{allAcked ? T.safetyNote : T.safetyNeed}</p>
                    </fieldset>
                  )}

                  <label className="check">
                    <input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                    <span>{T.consentText}</span>
                  </label>
                  {needsDeposit && (
                    <p className="notice notice--info">{t("depositNote", { amount: money(depositKnown), hours: refundHours })}</p>
                  )}
                  {showPolicyNote && <p className="notice notice--info">{T.depositPolicyNote}</p>}
                  <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={submitting || !allAcked}>
                    {submitting ? (needsDeposit ? T.openingPay : T.confirming) : otpAsk ? "Verificar y confirmar" : needsDeposit ? t("payAndConfirm", { amount: money(depositKnown) }) : apart ? t("confirmMany", { n: legs.length }) : T.confirm}
                  </button>
                </form>
              </>
            )}

            {/* ---------------- LISTO ---------------- */}
            {step === "done" && done && doneAll.length > 0 && (
              <div className="done">
                <button type="button" className="back done__back" onClick={back}>
                  <ArrowLeft size={18} aria-hidden="true" /> {T.backMenu}
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
                <h2 className="panel__title">{doneAll.length > 1 ? T.doneMany : T.doneOne}</h2>
                <ul className="donelist">
                  {doneAll.map((d) => (
                    <li key={d.code}>
                      <p className="done__when">{fmtLong(d.startsAt, locale)}</p>
                      <p className="muted">
                        {d.serviceName}
                        {multiStaff ? t("withStaff", { name: d.staffName }) : ""} · {money(d.priceCents)}
                      </p>
                      <p className="done__code">{T.code} <strong>{d.code}</strong></p>
                    </li>
                  ))}
                </ul>
                <p className="muted">{address}</p>
                <div className="done__actions">
                  <a className="btn btn--primary" href={icsHref(doneAll, address)} download={`cita-prodiva-${done.code}.ics`}>
                    <CalendarPlus size={17} aria-hidden="true" /> {T.addCalendar}
                  </a>
                  <a
                    className="btn btn--ghost"
                    href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(t("waMsg", { name: form.name, list: doneAll.map((d) => t("waItem", { service: d.serviceName, when: fmtLong(d.startsAt, locale), code: d.code })).join("; ") }))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle size={17} aria-hidden="true" /> {T.whatsapp}
                  </a>
                  <Link className="btn btn--ghost" href={`/c/${done.code}?t=${done.token}`}>{doneAll.length > 1 ? T.viewMany : T.viewOne}</Link>
                </div>
                {(() => {
                  const own = apart ? legs.map((l) => l.service) : [service, ...extras].filter((s): s is Service => !!s);
                  const rb = own.filter((s) => s.rebookWeeks);
                  return rb.length ? (
                    <RebookCard today={today} maxDate={maxDate} baseStartsAt={doneAll[0].startsAt} services={rb} contact={{ name: form.name, phone: form.phone, email: form.email }} acks={[...kinds]} />
                  ) : null;
                })()}
                <button type="button" className="btn btn--primary btn--lg btn--block" onClick={reset}>{T.bookAnother}</button>
                <Link className="back" href="/"><ArrowLeft size={16} aria-hidden="true" /> {T.backHomeWeb}</Link>
                <p className="muted small">{T.doneFooter}</p>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      <div className="flow__side">
      {step !== "done" && (
        <aside className={`summary ${visitServices.length ? "" : "summary--empty"}`} aria-label={T.summaryLabel}>
          <h2>{T.yourVisit}</h2>
          <dl>
            <dt>{apart ? T.yourAppointments : T.service}</dt>
            <dd>
              {apart ? (
                <ul className="summary__legs">
                  {legs.map((l) => (
                    <li key={l.service.id}><span>{L(l.service).name}</span><em>{l.hold ? fmtLong(l.hold.startsAt, locale) : T.noTime}</em></li>
                  ))}
                </ul>
              ) : visitServices.length ? (
                names(visitServices)
              ) : (
                T.unset
              )}
            </dd>
            {addonObjs.length > 0 && (
              <>
                <dt>{T.extrasTitle}</dt>
                <dd>{addonObjs.map((a) => L(a).name).join(" + ")}</dd>
              </>
            )}
            {service && (
              <>
                <dt>{T.durationPrice}</dt>
                <dd>{fmtDuration(totalDuration)} · {money(totalPrice)}</dd>
              </>
            )}
            {matchedPack && packSaving > 0 && (
              <>
                <dt>{matchedPack.emoji} {t("packBadge", { name: L(matchedPack).name })}</dt>
                <dd>{t("packSaved", { amount: money(packSaving) })}</dd>
              </>
            )}
            {needsDeposit && (
              <>
                <dt>{T.deposit}</dt>
                <dd>{t("depositSummary", { amount: money(depositKnown) })}</dd>
              </>
            )}
            {multiStaff && (
              <>
                <dt>{T.professional}</dt>
                <dd>{staffName ?? (step === "service" || step === "staff" ? T.unset : T.firstAvailable)}</dd>
              </>
            )}
            {!apart && (
              <>
                <dt>{T.dateTime}</dt>
                <dd>{hold ? fmtLong(hold.startsAt, locale) : T.unset}</dd>
              </>
            )}
          </dl>
          {allHolds.length > 0 && step !== "details" && <p className="summary__hold"><Lock size={13} aria-hidden="true" /> {t("locked", { t: mmss })}</p>}
        </aside>
      )}
      <BookingAvatar
        state={avatarState}
        trends={trends}
        services={services.map((s) => ({ slug: s.slug, name: L(s).name, category: s.category, durationMin: s.durationMin, priceCents: s.priceCents }))}
        packs={packs.map((p) => ({ slug: p.slug, name: L(p).name, serviceSlugs: p.serviceSlugs, discountPercent: p.discountPercent, people: p.people }))}
        selected={visitServices.map((x) => x.slug)}
        step={step}
        address={address}
        history={history.length > 0}
        onAdd={addFromAvatar}
      />
      </div>
    </div>
  );
}
