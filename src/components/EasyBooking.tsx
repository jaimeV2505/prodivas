"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, MapPin, MessageCircle, Share2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { addDays } from "@/lib/dates";
import { fmtDayLabel, fmtDuration, fmtLong, fmtPrice, localParts } from "@/lib/format";
import type { Pack, Service } from "./BookingFlow";
import { discounted, matchPack } from "@/lib/combos";
import { quizResult, quizServices, type Last as QuizLast, type QuizAnswers, type Style, type Time } from "@/lib/quiz";
import { icsHref } from "@/lib/ics";
import { loadSaved, saveBooking, saveVisitHistory } from "@/lib/myBookings";
import { getDict, type Dict } from "@/lib/i18n";
import { useStepHistory } from "@/lib/useStepHistory";
import { useLeadCapture } from "@/lib/useLead";
import { attribution, track } from "@/lib/track";
import OtpField from "./OtpField";
import CallbackForm from "./CallbackForm";
import DivaChat from "./DivaChat";
import PetalBurst from "./PetalBurst";
import StatusTag from "./StatusTag";
import WaitlistForm from "./WaitlistForm";
import "./easy.css";

type Step = "home" | "category" | "packs" | "quiz" | "service" | "day" | "time" | "details" | "done";
/** Orden de las pantallas: sirve para saber si se avanza o se retrocede y animar en el sentido correcto. */
const ORDER: Step[] = ["home", "category", "packs", "quiz", "service", "day", "time", "details", "done"];
/** Lo que se pide: un servicio, o varios juntos (un pack o la recomendación del test) con su precio ya rebajado. */
type Pick = Service & { ids?: number[]; slugs?: string[]; packSlug?: string; kinds?: ("laser" | "microblading")[] };
type Slot = { day: string; time: string; startsAt: string; available: boolean };
type Hold = { holdId: string; holdToken: string; startsAt: string; deadline: number; total: number };
type Last = { code: string; token: string; startsAt: string; serviceName: string };
type Done = Last & { endsAt: string };
type Profile = { name: string; phone: string; slug: string; serviceName: string; slugs?: string[]; staffId?: number };
type Mine = { code: string; token: string; status: string; attendance?: string | null; startsAt: string; endsAt?: string; serviceName: string; cancelReason?: string | null };

/** Vibración suave, solo si la persona ya ha tocado la pantalla (si no, el navegador lo marca como error). */
const buzz = () => {
  try {
    if ((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) navigator.vibrate?.(12);
  } catch {
    /* sin vibración */
  }
};

const PHONE_OK = /^[+\d][\d\s().-]{7,17}$/;
const isKind = (k: string | null | undefined): k is "laser" | "microblading" => k === "laser" || k === "microblading";

/** Une varios servicios en uno solo (suma duración, precio y señal); si es un pack, con su descuento. */
function combine(list: Service[], pack: Pack | null): Pick {
  const pct = pack?.discountPercent ?? 0;
  return {
    ...list[0],
    ids: list.map((x) => x.id),
    slugs: list.map((x) => x.slug),
    packSlug: pack?.slug,
    name: list.map((x) => x.name).join(" + "),
    description: null,
    durationMin: list.reduce((a, x) => a + x.durationMin, 0),
    priceCents: list.reduce((a, x) => a + discounted(x.priceCents, pct), 0),
    depositCents: list.reduce((a, x) => a + (x.depositCents ?? 0), 0),
    depositAlways: list.some((x) => x.depositAlways),
    waitMin: list.reduce((a, x) => a + (x.waitMin ?? 0), 0),
    consentKind: null,
    kinds: Array.from(new Set(list.map((x) => x.consentKind).filter(isKind))),
  };
}

/** Un emoji que reconoce a primera vista cada categoría y cada servicio. */
const catEmoji = (cat: string) => (/manicura|pedicura|u(ñ|n)as/i.test(cat) ? "💅" : /mirada|pesta|ceja/i.test(cat) ? "👁️" : /depila/i.test(cat) ? "🌸" : "✨");
const svcEmoji = (name: string, cat: string) =>
  /pedicura/i.test(name) ? "🦶" : /manicura/i.test(name) ? "💅" : /lifting|pesta/i.test(name) ? "👁️" : /tinte/i.test(name) ? "🎨" : /microblading/i.test(name) ? "✒️" : /ceja|hilo/i.test(name) ? "🪶" : /l(á|a)ser/i.test(name) ? "⚡" : catEmoji(cat);

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const dayParts = (d: string) => {
  const dt = new Date(`${d}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { ...o, timeZone: "UTC" }).format(dt).replace(".", "");
  return { wd: f({ weekday: "short" }), num: f({ day: "numeric" }), mon: f({ month: "short" }) };
};
const hhmm = (iso: string) => new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Madrid" }).format(new Date(iso));

/** «hoy», «mañana», «en 3 días»… según el día del salón. */
function relativeIn(iso: string, today: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "ahora";
  if (diffMs < 3600_000) return `en ${Math.max(1, Math.round(diffMs / 60000))} min`;
  const n = dayDiff(today, localParts(iso).day);
  if (n <= 0) return diffMs < 6 * 3600_000 ? `en ${Math.round(diffMs / 3600_000)} h` : "hoy";
  return n === 1 ? "mañana" : `en ${n} días`;
}

/** Anillo con la cuenta atrás del hueco guardado. */
function HoldRing({ remaining, total }: { remaining: number; total: number }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  const frac = total > 0 ? Math.min(1, remaining / total) : 0;
  const mm = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  return (
    <div className={`ez-ring ${remaining <= 60 ? "is-low" : ""}`} role="timer" aria-label={`Hueco guardado: quedan ${mm}`}>
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <circle cx="24" cy="24" r={R} className="ez-ring__bg" />
        <circle cx="24" cy="24" r={R} className="ez-ring__fg" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 24 24)" />
      </svg>
      <b>{mm}</b>
    </div>
  );
}

/**
 * «Tus citas» de la pantalla de inicio: la próxima cita como protagonista (con cuenta atrás), el resto compactas
 * y las canceladas recogidas (con su etiqueta roja).
 */
function EzMine({ today, mapsUrl, address }: { today: string; mapsUrl: string; address: string }) {
  const [items, setItems] = useState<Mine[] | null>(null);
  const [saved, setSaved] = useState(0);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const refs = loadSaved();
    setSaved(refs.length);
    if (!refs.length) {
      setItems([]);
      return;
    }
    let off = false;
    fetch("/api/my-bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: refs }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((j: { bookings: Mine[] }) => !off && setItems(j.bookings))
      .catch(() => !off && setItems([]));
    return () => {
      off = true;
    };
  }, []);
  const now = Date.now();
  const upcoming = (items ?? []).filter((b) => b.status === "CONFIRMED" && new Date(b.startsAt).getTime() >= now - 2 * 3600000);
  const cancelled = (items ?? []).filter((b) => b.status === "CANCELLED" && new Date(b.startsAt).getTime() > now - 7 * 86400000).slice(-4);

  if (items === null && saved > 0) return <div className="ez-skel ez-skel--card" aria-hidden="true" />;
  const [next, ...rest] = upcoming;
  const more = all ? rest : rest.slice(0, 1);
  return (
    <>
      {next && (
        <section className="ez-next" aria-label="Tu próxima cita">
          <div className="ez-next__top">
            <span className="ez-pill">Tu próxima cita</span>
            <span className="ez-next__in">{relativeIn(next.startsAt, today)}</span>
          </div>
          <p className="ez-next__when">{fmtLong(next.startsAt)}</p>
          <p className="ez-next__svc">{next.serviceName}</p>
          <div className="ez-next__row">
            <StatusTag status={next.status} attendance={next.attendance} startsAt={next.startsAt} cancelReason={next.cancelReason} />
            <a className="ez-next__map" href={mapsUrl} target="_blank" rel="noopener noreferrer" aria-label={`Cómo llegar: ${address}`}>
              <MapPin size={18} aria-hidden="true" /> Cómo llegar
            </a>
          </div>
          <a className="ez-btn ez-btn--ghost ez-btn--sm-w" href={`/c/${next.code}?t=${next.token}`}>
            Ver o cambiar <ArrowRight size={20} aria-hidden="true" />
          </a>
        </section>
      )}
      {more.length > 0 && (
        <ul className="ez-more" aria-label="Otras citas">
          {more.map((b) => (
            <li key={b.code}>
              <span><b>{fmtLong(b.startsAt)}</b><small>{b.serviceName}</small></span>
              <a href={`/c/${b.code}?t=${b.token}`}>Ver</a>
            </li>
          ))}
          {rest.length > 1 && (
            <li>
              <button type="button" className="ez-link" onClick={() => setAll((v) => !v)} aria-expanded={all}>
                {all ? "Ver menos" : `Ver las ${upcoming.length} citas`}
              </button>
            </li>
          )}
        </ul>
      )}
      {cancelled.length > 0 && (
        <details className="ez-cancelled">
          <summary>Canceladas ({cancelled.length})</summary>
          <ul className="ez-more">
            {cancelled.map((b) => (
              <li key={b.code}>
                <span><b>{fmtLong(b.startsAt)}</b><small>{b.serviceName}</small></span>
                <StatusTag status={b.status} attendance={b.attendance} startsAt={b.startsAt} cancelReason={b.cancelReason} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * Reserva "modo fácil": una sola pregunta por pantalla, botones enormes, sin calendario,
 * siempre con la opción de llamar. Pensada para quien no se maneja con la web.
 */
export default function EasyBooking({
  services,
  packs = [],
  today,
  address,
  mapsUrl,
  whatsapp,
  initialSlug,
  initialDay,
  depositEnabled = false,
  depositPolicy = "service",
  refundHours = 24,
}: {
  services: Service[];
  packs?: Pack[];
  today: string;
  address: string;
  mapsUrl: string;
  /** Teléfono del salón con prefijo de país y sin «+» (para wa.me). */
  whatsapp?: string;
  initialSlug?: string;
  initialDay?: string;
  depositEnabled?: boolean;
  depositPolicy?: "service" | "repeat";
  refundHours?: number;
}) {
  const reduce = useReducedMotion();
  // Enlaces de "se ha liberado un hueco": entran directos al servicio (y al día) elegidos
  const initSvc = services.find((x) => x.slug === initialSlug) ?? null;
  const initDay = initialDay && initialDay >= today ? initialDay : null;
  const [step, setStep] = useState<Step>(initSvc ? (initDay ? "time" : "day") : "home");
  const [category, setCategory] = useState<string | null>(initSvc?.category ?? null);
  const [service, setService] = useState<Pick | null>(initSvc);
  const [sel, setSel] = useState<Service[]>([]); // servicios marcados (se pueden elegir varios, también de distintas categorías)
  const [from, setFrom] = useState<Step>("service"); // de dónde vino la elección (para el botón «Atrás»)
  const [quizStep, setQuizStep] = useState(0);
  const [quizAns, setQuizAns] = useState<Partial<QuizAnswers>>({});
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(initSvc ? initDay : null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [otpAsk, setOtpAsk] = useState<{ devCode?: string } | null>(null);
  const [otp, setOtp] = useState("");
  // Señal: «según el servicio» o solo a quien ya ha faltado (entonces solo cuentan los servicios marcados «siempre»)
  const knownDeposit = service ? (depositPolicy === "repeat" ? (service.depositAlways ? service.depositCents ?? 0 : 0) : service.depositCents ?? 0) : 0;
  const safetyKinds = service?.kinds ?? (isKind(service?.consentKind) ? [service!.consentKind as "laser" | "microblading"] : []);
  const allAcked = safetyKinds.every((k) => [1, 2, 3].every((i) => acks[`${k}:${i}`]));
  const [done, setDone] = useState<Done | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [xl, setXl] = useState(false);
  const holdRef = useRef<Hold | null>(null);
  const prevStep = useRef<Step>(step);
  const dir = ORDER.indexOf(step) >= ORDER.indexOf(prevStep.current) ? 1 : -1;
  useEffect(() => {
    prevStep.current = step;
  }, [step]);

  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);

  // Perfil recordado en este móvil: saludo, "repetir mi cita" y datos ya escritos
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pd_profile");
      if (raw) {
        const p = JSON.parse(raw) as Profile;
        setProfile(p);
        setForm((f) => ({ name: f.name || p.name, phone: f.phone || p.phone }));
      }
      if (localStorage.getItem("pd_xl") === "1") setXl(true);
    } catch {
      /* nada */
    }
  }, []);
  useEffect(() => {
    if (xl) document.documentElement.dataset.xl = "1";
    else delete document.documentElement.dataset.xl;
    return () => {
      delete document.documentElement.dataset.xl;
    };
  }, [xl]);

  const categories = useMemo(() => Array.from(new Set(services.map((s) => s.category))), [services]);

  // Medición anónima del embudo (nunca datos personales)
  const slugsKey = service ? (service.slugs ?? [service.slug]).join(",") : "";
  useEffect(() => {
    if (slugsKey && (step === "day" || step === "time")) track("service", { flow: "easy", services: slugsKey.split(",") });
  }, [slugsKey, step]);
  useEffect(() => {
    if (slugsKey && step === "time" && slots && slots.some((x) => x.available)) track("slots", { flow: "easy", services: slugsKey.split(",") });
  }, [slugsKey, step, slots]);
  useEffect(() => {
    if (step === "details") track("details", { flow: "easy", services: slugsKey.split(",") });
  }, [step, slugsKey]);
  useLeadCapture({ holdId: step === "details" ? hold?.holdId : undefined, holdToken: hold?.holdToken, phone: form.phone, name: form.name, flow: "easy" });

  const loadSlots = useCallback(async () => {
    if (!service) return;
    const qs = new URLSearchParams({ serviceIds: (service.ids ?? [service.id]).join(","), from: today, to: addDays(today, 20) });
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

  const available = useMemo(() => (slots ?? []).filter((s) => s.available), [slots]);
  const days = useMemo(() => Array.from(new Set(available.map((s) => s.day))).sort(), [available]);
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of available) m.set(s.day, (m.get(s.day) ?? 0) + 1);
    return m;
  }, [available]);
  const dayLabel = (d: string) => (d === today ? "Hoy" : d === addDays(today, 1) ? "Mañana" : fmtDayLabel(d));
  const times = available.filter((s) => s.day === day);
  const morning = times.filter((s) => Number(s.time.slice(0, 2)) < 15);
  const afternoon = times.filter((s) => Number(s.time.slice(0, 2)) >= 15);
  const remaining = hold ? Math.max(0, Math.ceil((hold.deadline - now) / 1000)) : 0;

  // Atajos del paso «día»: el primer hueco libre, esta tarde y mañana (solo si existen de verdad)
  const quicks = useMemo(() => {
    const out: { key: string; label: string; slot: Slot }[] = [];
    const first = available[0];
    if (first) out.push({ key: "first", label: "Lo antes posible", slot: first });
    const tomorrow = addDays(today, 1);
    const aft = available.find((s) => s.day === today && Number(s.time.slice(0, 2)) >= 15);
    if (aft && aft.startsAt !== first?.startsAt) out.push({ key: "aft", label: "Esta tarde", slot: aft });
    const tom = available.find((s) => s.day === tomorrow);
    if (tom && tom.startsAt !== first?.startsAt) out.push({ key: "tom", label: "Mañana", slot: tom });
    return out;
  }, [available, today]);

  function stepBack(): boolean {
    setNotice(null);
    if (step === "category") setStep("home");
    else if (step === "packs") setStep("category");
    else if (step === "quiz") {
      if (quizStep > 0) setQuizStep(quizStep - 1);
      else setStep("category");
    } else if (step === "service") setStep("category");
    else if (step === "day") setStep(from);
    else if (step === "time") {
      dropHold();
      setStep("day");
    } else if (step === "details") setStep("time");
    else if (step === "done") restart();
    else return false;
    return true;
  }
  const back = useStepHistory(step, stepBack);

  async function pickTime(slot: Slot) {
    if (!service || busy) return;
    buzz();
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
        body: JSON.stringify({ serviceIds: service.ids ?? [service.id], ...(service.packSlug ? { packageSlug: service.packSlug } : {}), staffId: null, ...(profile?.staffId ? { preferStaffId: profile.staffId } : {}), startsAt: slot.startsAt }),
      });
      const j = await r.json();
      if (!r.ok) {
        setNotice(j?.error?.message ?? "Ese hueco ya no está libre. Elige otro.");
        await loadSlots();
        return;
      }
      track("hold", { flow: "easy", services: service.slugs ?? [service.slug], once: false });
      setHold({ holdId: j.holdId, holdToken: j.holdToken, startsAt: slot.startsAt, deadline: Date.now() + j.expiresInSec * 1000, total: j.expiresInSec });
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
        body: JSON.stringify({ holdId: hold.holdId, holdToken: hold.holdToken, name: form.name, phone: form.phone, ...(safetyKinds.length ? { acks: safetyKinds } : {}), ...(otpAsk && otp.length === 6 ? { otp } : {}), attr: { ...attribution(), flow: "easy" } }),
      });
      const j = await r.json();
      if (!r.ok) {
        const code = j?.error?.code as string | undefined;
        if (code === "VERIFY") {
          setOtpAsk({ devCode: j?.error?.data?.devCode as string | undefined });
          if (j?.error?.data?.wrong) setOtp("");
          setNotice(j?.error?.message ?? "Escribe el código que te hemos enviado.");
          return;
        }
        setNotice(j?.error?.message ?? "No hemos podido confirmar la cita.");
        if (code === "SLOT_TAKEN" || code === "HOLD_EXPIRED" || code === "NOT_FOUND") {
          setHold(null);
          setStep("time");
          void loadSlots();
        }
        return;
      }
      if (j.checkoutUrl) {
        // Pago de la señal en Stripe: el hueco debe seguir bloqueado mientras tanto
        holdRef.current = null;
        window.location.assign(j.checkoutUrl as string);
        return;
      }
      const b = j.booking as Done;
      setDone(b);
      setHold(null);
      setStep("done");
      try {
        saveBooking(b.code, b.token);
        saveVisitHistory({ startsAt: b.startsAt, slugs: service ? (service.slugs ?? [service.slug]) : [] });
        const np: Profile = { name: form.name, phone: form.phone, staffId: (b as { staffId?: number }).staffId ?? profile?.staffId, slug: service?.slug ?? "", serviceName: b.serviceName, slugs: service ? (service.slugs ?? [service.slug]) : [] };
        localStorage.setItem("pd_profile", JSON.stringify(np));
        setProfile(np);
      } catch {
        /* nada */
      }
    } catch {
      setNotice("No hay conexión. Tu hueco sigue guardado: inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  }

  // «Repetir mi cita»: los mismos servicios de la última vez (uno o varios)
  const repeatSlugs = profile ? (profile.slugs?.length ? profile.slugs : profile.slug ? [profile.slug] : []) : [];
  const canRepeat = repeatSlugs.length > 0 && repeatSlugs.every((sl) => services.some((x) => x.slug === sl));
  const repeatList = canRepeat ? repeatSlugs.map((sl) => services.find((x) => x.slug === sl)).filter((x): x is Service => !!x) : [];
  function repeatLast() {
    const list = repeatSlugs.map((sl) => services.find((x) => x.slug === sl)).filter((x): x is Service => !!x);
    if (!list.length || list.length !== repeatSlugs.length) {
      setStep("category");
      return;
    }
    pickList(list, null, "home");
  }

  // Packs y recomendaciones: servicios sueltos o varios juntos (los packs de dos personas se piden en la reserva completa)
  const easyPacks = useMemo(
    () =>
      packs
        .filter((p) => (p.people ?? 1) === 1)
        .map((p) => ({ p, list: p.serviceSlugs.map((sl) => services.find((x) => x.slug === sl)).filter((x): x is Service => !!x) }))
        .filter((x) => x.list.length === x.p.serviceSlugs.length && x.list.length > 0),
    [packs, services],
  );
  function pickList(list: Service[], pack: Pack | null, origin: Step) {
    buzz();
    dropHold();
    // si los servicios coinciden con un pack, se aplica su descuento aunque no lo haya elegido desde «Packs»
    const pk = pack ?? (list.length > 1 ? matchPack(list.map((x) => x.slug), packs.filter((x) => (x.people ?? 1) === 1)) : null);
    setCategory(list[0].category);
    setService(list.length === 1 && !pk ? list[0] : combine(list, pk));
    setSlots(null);
    setDay(null);
    setFrom(origin);
    setStep("day");
  }
  /** Para Diva (y cualquier atajo): elige esos servicios por su slug y salta directamente al paso del día. */
  function chooseSlugs(slugs: string[], slot?: { day: string }) {
    const list = slugs.map((sl) => services.find((x) => x.slug === sl)).filter((x): x is Service => !!x);
    if (!list.length) return;
    setSel(list);
    pickList(list, null, "category");
    if (slot?.day) {
      // Diva ofreció un hueco concreto: se va directo a las horas de ese día
      setDay(slot.day);
      setStep("time");
    }
  }

  const QUIZ: { q: keyof Dict; field: keyof QuizAnswers; opts: [string, keyof Dict][] }[] = [
    { q: "quizQ1", field: "time", opts: [["short", "quizQ1a"], ["normal", "quizQ1b"], ["long", "quizQ1c"]] },
    { q: "quizQ2", field: "style", opts: [["natural", "quizQ2a"], ["classic", "quizQ2b"], ["bold", "quizQ2c"]] },
    { q: "quizQ3", field: "last", opts: [["event", "quizQ3a"], ["weeks", "quizQ3b"], ["max", "quizQ3c"]] },
  ];
  const quizId = quizStep >= 3 ? quizResult(quizAns as QuizAnswers) : null;
  const RESULT_KEY = { quick: ["quizRQuickT", "quizRQuickB"], daily: ["quizRDailyT", "quizRDailyB"], pair: ["quizRPairT", "quizRPairB"], full: ["quizRFullT", "quizRFullB"] } as const;
  const TIP_KEY = { natural: "quizTipNatural", classic: "quizTipClassic", bold: "quizTipBold" } as const;

  function toggleXl() {
    const next = !xl;
    setXl(next);
    try {
      localStorage.setItem("pd_xl", next ? "1" : "0");
    } catch {
      /* nada */
    }
  }

  function restart() {
    setStep("home");
    setQuizStep(0);
    setQuizAns({});
    setFrom("service");
    setCategory(null);
    setService(null);
    setSel([]);
    setSlots(null);
    setDay(null);
    setDone(null);
    setNotice(null);
    setPhoneTouched(false);
    setForm({ name: "", phone: "" });
  }

  function toggleSel(s: Service) {
    buzz();
    setSel((cur) => (cur.some((x) => x.id === s.id) ? cur.filter((x) => x.id !== s.id) : [...cur, s]));
  }

  const stepNo = step === "category" || step === "service" || step === "packs" || step === "quiz" ? 1 : step === "day" ? 2 : step === "time" ? 3 : step === "details" ? 4 : 0;
  const CRUMBS = ["Servicio", "Día", "Hora", "Tus datos"];
  const phoneOk = PHONE_OK.test(form.phone.trim());
  const selTotal = { dur: sel.reduce((a, x) => a + x.durationMin, 0), price: sel.reduce((a, x) => a + x.priceCents, 0), wait: sel.reduce((a, x) => a + (x.waitMin ?? 0), 0) };
  const showSelBar = (step === "category" || step === "service") && sel.length > 0;
  const hasBar = showSelBar || (step === "details" && !!hold);
  const waLink = (text: string) => `https://wa.me/${whatsapp ?? ""}?text=${encodeURIComponent(text)}`;

  async function share() {
    if (!done) return;
    const text = `Tengo cita en Pro Diva (Melide) el ${fmtLong(done.startsAt)}. ¡Reserva la tuya!`;
    const url = typeof window !== "undefined" ? `${window.location.origin}/cita` : "";
    try {
      if (navigator.share) await navigator.share({ title: "Pro Diva", text, url });
      else window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank", "noopener,noreferrer");
    } catch {
      /* cancelado */
    }
  }

  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, x: dir * 26 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: dir * -18, transition: { duration: 0.12 } },
        transition: { duration: 0.26, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] },
      };

  const price0 = repeatList.reduce((a, x) => a + x.priceCents, 0);
  const dur0 = repeatList.reduce((a, x) => a + x.durationMin, 0);

  return (
    <div className={`easy ez ${hasBar ? "ez--bar" : ""}`}>
      <div className="ez-top">
        {step !== "home" ? (
          <button type="button" className="ez-back" onClick={back}>
            <ArrowLeft size={22} aria-hidden="true" /> {step === "done" ? "Volver al menú" : "Atrás"}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="ez-tool" aria-pressed={xl} onClick={toggleXl}>
          <span aria-hidden="true">Aa</span> {xl ? "Letra normal" : "Letra grande"}
        </button>
      </div>

      {stepNo > 0 && (
        <nav className="ez-steps" aria-label={`Paso ${stepNo} de 4`}>
          <div className="ez-steps__bar" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={stepNo} aria-label={`Paso ${stepNo} de 4`}>
            <i style={{ width: `${(stepNo / 4) * 100}%` }} />
          </div>
          <ol>
            {CRUMBS.map((c, i) => (
              <li key={c} className={i + 1 < stepNo ? "is-done" : i + 1 === stepNo ? "is-now" : ""} aria-current={i + 1 === stepNo ? "step" : undefined}>
                <span>{i + 1 < stepNo ? <Check size={13} aria-hidden="true" /> : i + 1}</span> <em>{c}</em>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {notice && <p className="notice notice--error easy__notice ez-notice" role="alert">{notice}</p>}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} className="ez-step" {...motionProps}>
          {step === "home" && (
            <>
              <header className="ez-hello">
                <h1 className="ez-title">{profile?.name ? `Hola, ${profile.name.split(" ")[0]} ` : "¿Quieres pedir cita?"}{profile?.name && <span aria-hidden="true">👋</span>}</h1>
                <p className="ez-lead">{profile?.name ? "¿Qué te apetece hoy?" : "Elige lo que quieres, el día y la hora. Sin registrarte."}</p>
              </header>
              <EzMine today={today} mapsUrl={mapsUrl} address={address} />
              {canRepeat && (
                <button type="button" className="ez-hero" onClick={repeatLast}>
                  <span className="ez-hero__k"><Zap size={16} aria-hidden="true" /> Lo de siempre, en un toque</span>
                  <span className="ez-hero__t">Repetir: {profile?.serviceName}</span>
                  <span className="ez-hero__m">{fmtDuration(dur0)} · {fmtPrice(price0)} <ArrowRight size={22} aria-hidden="true" /></span>
                </button>
              )}
              <button
                type="button"
                className={`ez-btn ${canRepeat ? "ez-btn--ghost" : "ez-btn--main"}`}
                onClick={() => {
                  buzz();
                  setStep("category");
                }}
              >
                {canRepeat ? "Pedir otra cosa" : "Pedir cita"} <ArrowRight size={22} aria-hidden="true" />
              </button>
              <CallbackForm initialName={profile?.name ?? ""} initialPhone={profile?.phone ?? ""} />
              <ul className="ez-trust" aria-label="Por qué pedir aquí">
                <li><ShieldCheck size={18} aria-hidden="true" /> Sin registrarte</li>
                <li><Clock size={18} aria-hidden="true" /> En 1 minuto</li>
                <li><Sparkles size={18} aria-hidden="true" /> Aviso por mensaje</li>
              </ul>
            </>
          )}

          {step === "category" && (
            <>
              <h1 className="ez-title">¿Qué te quieres hacer?</h1>
              {(easyPacks.length > 0 || services.length > 0) && (
                <div className="ez-quick">
                  {easyPacks.length > 0 && (
                    <button type="button" className="ez-quick__b" onClick={() => { buzz(); setStep("packs"); }}>
                      <b>🎁 Packs listos</b>
                      <small>Varias cosas en una visita</small>
                    </button>
                  )}
                  <button type="button" className="ez-quick__b" onClick={() => { buzz(); setQuizStep(0); setQuizAns({}); setStep("quiz"); }}>
                    <b>🎀 Haz el test</b>
                    <small>¿No sabes qué elegir? 20 segundos</small>
                  </button>
                </div>
              )}
              <div className="ez-cats">
                {categories.map((c) => {
                  const list = services.filter((s) => s.category === c);
                  const n = sel.filter((s) => s.category === c).length;
                  return (
                    <button key={c} type="button" className="ez-cat" onClick={() => { buzz(); setCategory(c); setStep("service"); }}>
                      <span className="ez-cat__ico" aria-hidden="true">{catEmoji(c)}</span>
                      <span className="ez-cat__txt">
                        <b>{c}</b>
                        <small>{list.length} {list.length === 1 ? "servicio" : "servicios"} · desde {fmtPrice(Math.min(...list.map((s) => s.priceCents)))}</small>
                      </span>
                      {n > 0 ? <span className="ez-badge">{n}</span> : <ChevronRight size={24} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === "packs" && (
            <>
              <h1 className="ez-title">🎁 Packs listos</h1>
              <p className="ez-lead">Varias cosas en una sola visita.</p>
              <div className="ez-list">
                {easyPacks.map(({ p, list }) => {
                  const full = list.reduce((a, x) => a + x.priceCents, 0);
                  const price = list.reduce((a, x) => a + discounted(x.priceCents, p.discountPercent), 0);
                  return (
                    <button key={p.id} type="button" className="ez-svc" onClick={() => pickList(list, p, "packs")}>
                      <span className="ez-svc__ico" aria-hidden="true">{p.emoji}</span>
                      <span className="ez-svc__txt">
                        <b>{p.name}</b>
                        <small>{list.map((x) => x.name).join(" + ")}</small>
                        <small>{fmtDuration(list.reduce((a, x) => a + x.durationMin, 0))}{p.featured ? " · ⭐ Destacado" : ""}</small>
                      </span>
                      <span className="ez-svc__price">
                        {fmtPrice(price)}
                        {p.discountPercent > 0 && <small>{`Ahorras ${fmtPrice(full - price)}`}</small>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === "quiz" && (
            <>
              {quizId === null ? (
                <>
                  <p className="ez-kicker">Pregunta {quizStep + 1} de 3</p>
                  <div className="ez-quizbar" aria-hidden="true"><i style={{ width: `${((quizStep + 1) / 3) * 100}%` }} /></div>
                  <h1 className="ez-title">{getDict()[QUIZ[quizStep].q]}</h1>
                  <div className="ez-list">
                    {QUIZ[quizStep].opts.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className="ez-opt"
                        onClick={() => {
                          buzz();
                          setQuizAns({ ...quizAns, [QUIZ[quizStep].field]: id as Time | Style | QuizLast });
                          setQuizStep(quizStep + 1);
                        }}
                      >
                        {getDict()[label]} <ChevronRight size={22} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h1 className="ez-title">🎀 {getDict()[RESULT_KEY[quizId][0]]}</h1>
                  <p className="ez-lead">{getDict()[RESULT_KEY[quizId][1]]}</p>
                  <p className="ez-tip">{getDict()[TIP_KEY[(quizAns as QuizAnswers).style]]}</p>
                  <button
                    type="button"
                    className="ez-btn ez-btn--main"
                    onClick={() => {
                      const list = quizServices(quizId, services.map((x) => x.slug)).map((sl) => services.find((x) => x.slug === sl)).filter((x): x is Service => !!x);
                      if (list.length) pickList(list, null, "quiz");
                    }}
                  >
                    Pedir esto <ArrowRight size={22} aria-hidden="true" />
                  </button>
                  <button type="button" className="ez-btn ez-btn--ghost" onClick={() => { setQuizStep(0); setQuizAns({}); }}>
                    Repetir el test
                  </button>
                </>
              )}
            </>
          )}

          {step === "service" && (
            <>
              <h1 className="ez-title">{catEmoji(category ?? "")} {category}</h1>
              <p className="ez-lead">Toca los que quieras. Puedes juntar varios en una misma visita.</p>
              <div className="ez-list" role="group" aria-label="Servicios">
                {services.filter((s) => s.category === category).map((s) => {
                  const on = sel.some((x) => x.id === s.id);
                  return (
                    <button key={s.id} type="button" className={`ez-svc ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => toggleSel(s)}>
                      <span className="ez-svc__ico" aria-hidden="true">{svcEmoji(s.name, s.category)}</span>
                      <span className="ez-svc__txt">
                        <b>{s.name}</b>
                        <small>{fmtDuration(s.durationMin)}{s.waitMin ? ` · incluye ${s.waitMin} min de pose` : ""}</small>
                        {s.description && <small className="ez-svc__d">{s.description}</small>}
                      </span>
                      <span className="ez-svc__price">{fmtPrice(s.priceCents)}</span>
                      <span className="ez-check" aria-hidden="true">{on && <Check size={18} />}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="ez-link ez-link--c" onClick={() => setStep("category")}>
                {sel.length > 0 ? "+ Añadir algo de otra categoría" : "Ver otras categorías"}
              </button>
            </>
          )}

          {step === "day" && service && (
            <>
              <h1 className="ez-title">¿Qué día te viene bien?</h1>
              <p className="ez-lead ez-lead--svc">{service.name}{service.waitMin ? ` · incluye ${service.waitMin} min de pose` : ""}</p>
              {slots === null && (
                <div aria-live="polite" aria-busy="true">
                  <div className="ez-skel ez-skel--hero" />
                  <div className="ez-rail ez-rail--skel">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="ez-skel ez-skel--chip" />)}</div>
                </div>
              )}
              {slots !== null && days.length === 0 && (
                <div className="ez-empty">
                  <p className="ez-empty__e" aria-hidden="true">🌙</p>
                  <p><b>No quedan huecos en los próximos días.</b></p>
                  <p className="ez-lead">Déjanos tu teléfono y te avisamos en cuanto se libere uno.</p>
                  <WaitlistForm serviceId={service.id} serviceIds={service.ids} day={null} source="app" startOpen />
                  <CallbackForm initialName={profile?.name ?? ""} initialPhone={profile?.phone ?? ""} />
                </div>
              )}
              {quicks.length > 0 && (
                <div className="ez-fast">
                  {quicks.map((q, i) => (
                    <button
                      key={q.key}
                      type="button"
                      className={`ez-fast__b ${i === 0 ? "is-first" : ""}`}
                      disabled={busy}
                      onClick={() => {
                        setDay(q.slot.day);
                        void pickTime(q.slot);
                      }}
                    >
                      <span className="ez-fast__k">{i === 0 && <Zap size={16} aria-hidden="true" />} {q.label}</span>
                      <span className="ez-fast__t">{(() => {
                        const dl = q.slot.day === today ? "Hoy" : q.slot.day === addDays(today, 1) ? "Mañana" : dayParts(q.slot.day).wd;
                        return dl === q.label ? q.slot.time : `${dl} · ${q.slot.time}`;
                      })()}</span>
                    </button>
                  ))}
                </div>
              )}
              {days.length > 0 && (
                <>
                  <h2 className="ez-sub">O elige el día</h2>
                  <div className="ez-rail" role="list" aria-label="Días con huecos">
                    {days.map((d) => {
                      const p = dayParts(d);
                      const n = perDay.get(d) ?? 0;
                      const rel = d === today ? "Hoy" : d === addDays(today, 1) ? "Mañana" : "";
                      return (
                        <button
                          key={d}
                          type="button"
                          role="listitem"
                          className={`ez-day ${rel ? "is-rel" : ""}`}
                          aria-label={`${dayLabel(d)}${n <= 2 ? `, quedan ${n} huecos` : ""}`}
                          onClick={() => {
                            buzz();
                            setDay(d);
                            setStep("time");
                          }}
                        >
                          <small>{rel || p.wd}</small>
                          <b>{p.num}</b>
                          <small>{p.mon}</small>
                          {n <= 2 && <em>Últimos</em>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {step === "time" && day && (
            <>
              <h1 className="ez-title">¿A qué hora?</h1>
              <div className="ez-daynav">
                <button type="button" aria-label="Día anterior" disabled={days.indexOf(day) <= 0} onClick={() => setDay(days[days.indexOf(day) - 1])}>
                  <ChevronLeft size={24} aria-hidden="true" />
                </button>
                <p><b>{dayLabel(day)}</b><small>{service?.name}</small></p>
                <button type="button" aria-label="Día siguiente" disabled={days.indexOf(day) < 0 || days.indexOf(day) >= days.length - 1} onClick={() => setDay(days[days.indexOf(day) + 1])}>
                  <ChevronRight size={24} aria-hidden="true" />
                </button>
              </div>
              {slots === null && (
                <div className="ez-times" aria-busy="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="ez-skel ez-skel--time" />)}</div>
              )}
              {[{ t: "Por la mañana", e: "☀️", l: morning }, { t: "Por la tarde", e: "🌇", l: afternoon }].map(
                (g) =>
                  g.l.length > 0 && (
                    <section key={g.t}>
                      <h2 className="ez-sub">{g.e} {g.t}</h2>
                      <div className="ez-times">
                        {g.l.map((s) => (
                          <button key={s.startsAt} type="button" className={`ez-time ${s.startsAt === times[0]?.startsAt ? "is-first" : ""}`} disabled={busy} onClick={() => void pickTime(s)}>
                            {s.time}
                            {s.startsAt === times[0]?.startsAt && <small>Más pronto</small>}
                          </button>
                        ))}
                      </div>
                    </section>
                  ),
              )}
              {times.length === 0 && slots !== null && (
                <div className="ez-empty">
                  <p className="ez-empty__e" aria-hidden="true">🕊️</p>
                  <p><b>Ese día ya no quedan huecos.</b></p>
                  <p className="ez-lead">Prueba otro día o te avisamos si se libera uno.</p>
                  <button type="button" className="ez-btn ez-btn--ghost" onClick={() => setStep("day")}>Ver otros días</button>
                </div>
              )}
              {service && slots !== null && (
                <WaitlistForm key={day} serviceId={service.id} serviceIds={service.ids} day={day} dayLabel={dayLabel(day)} source="app" startOpen={times.length === 0} />
              )}
            </>
          )}

          {step === "details" && service && hold && (
            <>
              <h1 className="ez-title">Casi lista ✨</h1>
              <p className="ez-lead">Solo necesitamos dos datos para guardar tu cita.</p>
              <form id="ez-form" onSubmit={confirm} className="ez-form" noValidate={false}>
                <label className="ez-field">
                  <span>Tu nombre</span>
                  <input required autoComplete="name" enterKeyHint="next" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} placeholder="Nombre y apellidos" />
                </label>
                <label className={`ez-field ${phoneTouched && form.phone && !phoneOk ? "is-bad" : phoneOk ? "is-ok" : ""}`}>
                  <span>Tu teléfono <em>(te avisaremos por mensaje)</em></span>
                  <div className="ez-field__box">
                    <input
                      required
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      enterKeyHint="done"
                      value={form.phone}
                      aria-invalid={phoneTouched && !phoneOk}
                      aria-describedby="ez-phone-help"
                      onBlur={() => setPhoneTouched(true)}
                      onChange={(e) => {
                        setOtpAsk(null);
                        setOtp("");
                        setForm({ ...form, phone: e.target.value });
                      }}
                      placeholder="600 123 456"
                    />
                    {phoneOk && <Check size={22} aria-hidden="true" />}
                  </div>
                  <small id="ez-phone-help" role={phoneTouched && form.phone && !phoneOk ? "alert" : undefined}>
                    {phoneTouched && form.phone && !phoneOk ? "Revisa el número: tiene que tener al menos 8 cifras." : "Solo para avisarte de tu cita. Nada de publicidad."}
                  </small>
                </label>
                {otpAsk && <OtpField value={otp} onChange={setOtp} devCode={otpAsk.devCode} phone={form.phone} />}
                {safetyKinds.map((k) => (
                  <fieldset key={k} className="safety easy__safety">
                    <legend>{getDict().safetyTitle} · {getDict()[`${k}Title` as "laserTitle"]}</legend>
                    {[1, 2, 3].map((i) => (
                      <label key={i} className="check">
                        <input type="checkbox" required checked={!!acks[`${k}:${i}`]} onChange={(e) => setAcks({ ...acks, [`${k}:${i}`]: e.target.checked })} />
                        <span>{getDict()[`${k}${i}` as "laser1"]}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
                {safetyKinds.length > 0 && <p className="muted small">{allAcked ? getDict().safetyNote : getDict().safetyNeed}</p>}
                {depositEnabled && knownDeposit > 0 && (
                  <p className="notice notice--info easy__notice">
                    Este servicio lleva una <b>señal de {fmtPrice(knownDeposit)}</b> que se descuenta del total. Si cancelas con {refundHours} horas o más te la devolvemos. La pagas con tarjeta en el siguiente paso.
                  </p>
                )}
                {depositEnabled && depositPolicy === "repeat" && <p className="notice notice--info easy__notice">{getDict().depositPolicyNote}</p>}
                <p className="ez-legal">
                  <ShieldCheck size={16} aria-hidden="true" /> <span>Al confirmar, Pro Diva usará tus datos para gestionar tu cita y enviarte la confirmación y un recordatorio por WhatsApp o SMS. Si no terminas, te escribiremos una sola vez por si quieres retomarla. <a href="/privacidad">Privacidad</a></span>
                </p>
              </form>
            </>
          )}

          {step === "done" && done && (
            <section className="ez-done">
              <PetalBurst />
              <motion.span
                className="ez-tick"
                initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", duration: 0.55, bounce: 0.35 }}
              >
                <svg viewBox="0 0 52 52" width="64" height="64" aria-hidden="true">
                  <motion.path d="M14 27 l9 9 l16 -18" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.45, ease: "easeOut" }} />
                </svg>
              </motion.span>
              <h1 className="ez-title ez-title--c">¡Cita confirmada!</h1>
              <p className="ez-lead ez-lead--c">Te esperamos con muchas ganas 💖</p>
              <article className="ez-ticket" aria-label="Tu cita">
                <div className="ez-ticket__when">
                  <b>{fmtDayLabel(localParts(done.startsAt).day)}</b>
                  <span>{hhmm(done.startsAt)}{done.endsAt ? ` – ${hhmm(done.endsAt)}` : ""}</span>
                </div>
                <div className="ez-ticket__cut" aria-hidden="true" />
                <p className="ez-ticket__svc">{done.serviceName}</p>
                <p className="ez-ticket__loc"><MapPin size={16} aria-hidden="true" /> {address}</p>
                <p className="ez-ticket__code">Código <b>{done.code}</b></p>
              </article>
              <p className="ez-lead ez-lead--c">El mismo día te escribiremos para que confirmes con un toque.</p>
              <div className="ez-actions">
                <a className="ez-btn ez-btn--ghost" href={icsHref({ code: done.code, title: `${done.serviceName} en Pro Diva`, startsAt: done.startsAt, endsAt: done.endsAt, location: address })} download={`cita-prodiva-${done.code}.ics`}>
                  <CalendarPlus size={22} aria-hidden="true" /> Añadir al calendario
                </a>
                <a className="ez-btn ez-btn--ghost" href={mapsUrl} target="_blank" rel="noopener noreferrer">
                  <MapPin size={22} aria-hidden="true" /> Cómo llegar
                </a>
                {whatsapp && (
                  <a className="ez-btn ez-btn--ghost" href={waLink(`Hola, soy ${form.name || "una clienta"}. Tengo cita el ${fmtLong(done.startsAt)} (código ${done.code}).`)} target="_blank" rel="noopener noreferrer">
                    <MessageCircle size={22} aria-hidden="true" /> Avisar por WhatsApp
                  </a>
                )}
                <button type="button" className="ez-btn ez-btn--ghost" onClick={() => void share()}>
                  <Share2 size={22} aria-hidden="true" /> Compartir
                </button>
              </div>
              <a className="ez-friend" href={`/c/${done.code}?t=${done.token}`}>
                <span aria-hidden="true">💌</span>
                <span><b>Ver mi cita y mi enlace de amiga</b><small>Trae a una amiga: las dos ganáis un premio</small></span>
                <ChevronRight size={22} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="ez-btn ez-btn--main"
                onClick={() => {
                  restart();
                  setStep("category");
                }}
              >
                Pedir otra cita
              </button>
              <button type="button" className="ez-link ez-link--c" onClick={restart}>Ver mis citas</button>
            </section>
          )}
        </motion.div>
      </AnimatePresence>

      <DivaChat flow="easy" services={services} packs={packs} chosenSlugs={service ? (service.slugs ?? [service.slug]) : sel.map((x) => x.slug)} step={step} onChoose={chooseSlugs} />

      {showSelBar && (
        <div className="ez-bar" role="region" aria-label="Tu selección">
          <div className="ez-bar__txt">
            <b>{sel.length} {sel.length === 1 ? "servicio" : "servicios"}</b>
            <small>
              {fmtDuration(selTotal.dur)}{selTotal.wait ? ` (incluye ${selTotal.wait} min de pose)` : ""} · {fmtPrice(selTotal.price)}
            </small>
          </div>
          <button type="button" className="ez-bar__clear" onClick={() => setSel([])} aria-label="Quitar la selección">Quitar</button>
          <button type="button" className="ez-btn ez-btn--main ez-btn--bar" onClick={() => pickList(sel, null, step)}>
            Elegir día <ArrowRight size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      {step === "details" && hold && service && (
        <div className="ez-bar ez-bar--hold" role="region" aria-label="Resumen de tu cita">
          <HoldRing remaining={remaining} total={hold.total} />
          <div className="ez-bar__txt">
            <b>{service.name}</b>
            <small>{fmtLong(hold.startsAt)}</small>
          </div>
          <button type="submit" form="ez-form" className="ez-btn ez-btn--main ez-btn--bar" disabled={busy || !allAcked || !phoneOk || form.name.trim().length < 2}>
            {busy ? "Un momento…" : otpAsk ? "Verificar" : depositEnabled && knownDeposit > 0 ? `Pagar ${fmtPrice(knownDeposit)}` : "Confirmar"}
          </button>
        </div>
      )}
    </div>
  );
}
