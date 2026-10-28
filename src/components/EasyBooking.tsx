"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CalendarPlus, Check, Eye, Flower2, Hand, Lock, MapPin, Sparkles, type LucideIcon } from "lucide-react";
import { addDays } from "@/lib/dates";
import { fmtDayLabel, fmtDuration, fmtLong, fmtPrice } from "@/lib/format";
import type { Pack, Service } from "./BookingFlow";
import { discounted, matchPack } from "@/lib/combos";
import { quizResult, quizServices, type Last as QuizLast, type QuizAnswers, type Style, type Time } from "@/lib/quiz";
import { icsHref } from "@/lib/ics";
import { saveBooking, saveVisitHistory } from "@/lib/myBookings";
import { getDict, type Dict } from "@/lib/i18n";
import MyBookings from "./MyBookings";
import { useStepHistory } from "@/lib/useStepHistory";
import { useLeadCapture } from "@/lib/useLead";
import { attribution, track } from "@/lib/track";
import OtpField from "./OtpField";
import CallbackForm from "./CallbackForm";
import PetalBurst from "./PetalBurst";
import WaitlistForm from "./WaitlistForm";

type Step = "home" | "category" | "packs" | "quiz" | "service" | "day" | "time" | "details" | "done";
/** Lo que se pide: un servicio, o varios juntos (un pack o la recomendación del test) con su precio ya rebajado. */
type Pick = Service & { ids?: number[]; slugs?: string[]; packSlug?: string; kinds?: ("laser" | "microblading")[] };
type Slot = { day: string; time: string; startsAt: string; available: boolean };
type Hold = { holdId: string; holdToken: string; startsAt: string; deadline: number };
type Last = { code: string; token: string; startsAt: string; serviceName: string };
type Done = Last & { endsAt: string };
type Profile = { name: string; phone: string; slug: string; serviceName: string; slugs?: string[]; staffId?: number };

const buzz = () => {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* sin vibración */
  }
};

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
    consentKind: null,
    kinds: Array.from(new Set(list.map((x) => x.consentKind).filter(isKind))),
  };
}

const iconFor = (cat: string): LucideIcon =>
  /manicura|pedicura|u(ñ|n)as/i.test(cat) ? Hand : /mirada|pesta|ceja/i.test(cat) ? Eye : /depila/i.test(cat) ? Sparkles : Flower2;

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
  initialSlug?: string;
  initialDay?: string;
  depositEnabled?: boolean;
  depositPolicy?: "service" | "repeat";
  refundHours?: number;
}) {
  // Enlaces de "se ha liberado un hueco": entran directos al servicio (y al día) elegidos
  const initSvc = services.find((x) => x.slug === initialSlug) ?? null;
  const initDay = initialDay && initialDay >= today ? initialDay : null;
  const [step, setStep] = useState<Step>(initSvc ? (initDay ? "time" : "day") : "home");
  const [category, setCategory] = useState<string | null>(initSvc?.category ?? null);
  const [service, setService] = useState<Pick | null>(initSvc);
  const [from, setFrom] = useState<Step>("service"); // de dónde vino la elección (para el botón «Atrás»)
  const [quizStep, setQuizStep] = useState(0);
  const [quizAns, setQuizAns] = useState<Partial<QuizAnswers>>({});
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [showAllDays, setShowAllDays] = useState(false);
  const [day, setDay] = useState<string | null>(initSvc ? initDay : null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "" });
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
        localStorage.setItem("pd_profile", JSON.stringify({ name: form.name, phone: form.phone, staffId: (b as { staffId?: number }).staffId ?? profile?.staffId, slug: service?.slug ?? "", serviceName: b.serviceName, slugs: service ? (service.slugs ?? [service.slug]) : [] }));
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
    setShowAllDays(false);
    setFrom(origin);
    setStep("day");
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
    setSlots(null);
    setDay(null);
    setDone(null);
    setNotice(null);
    setForm({ name: "", phone: "" });
  }

  const stepNo = step === "category" || step === "service" || step === "packs" || step === "quiz" ? 1 : step === "day" ? 2 : step === "time" ? 3 : step === "details" ? 4 : 0;

  const Back = () => (
    <button type="button" className="easy__back" onClick={back}>
      <ArrowLeft size={26} aria-hidden="true" /> Atrás
    </button>
  );

  return (
    <div className="easy">
      <div className="easy__tools">
        <button type="button" className="easy__tool" aria-pressed={xl} onClick={toggleXl}>
          {xl ? "Letra normal" : "Letra grande"}
        </button>
      </div>
      {stepNo > 0 && (
        <div className="easy__progress" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={stepNo} aria-label={`Paso ${stepNo} de 4`}>
          <span>Paso {stepNo} de 4</span>
          <div><i style={{ width: `${stepNo * 25}%` }} /></div>
        </div>
      )}
      {notice && <p className="notice notice--error easy__notice" role="alert">{notice}</p>}

      <div key={step} className="easy__step">
      {step === "home" && (
        <>
          <h1 className="easy__h">{profile?.name ? `Hola, ${profile.name.split(" ")[0]}` : "¿Quieres pedir cita?"}</h1>
          <MyBookings variant="easy">
          {canRepeat && (
            <button type="button" className="easy__btn easy__btn--main" onClick={repeatLast}>
              Repetir: {profile?.serviceName}
            </button>
          )}
          <button
            type="button"
            className={`easy__btn ${canRepeat ? "easy__btn--soft" : "easy__btn--main"}`}
            onClick={() => {
              buzz();
              setStep("category");
            }}
          >
            {canRepeat ? "Pedir otra cosa" : "Pedir cita"}
          </button>
          <CallbackForm initialName={profile?.name ?? ""} initialPhone={profile?.phone ?? ""} />
          </MyBookings>
        </>
      )}

      {step === "category" && (
        <>
          <Back />
          <h1 className="easy__h">¿Qué te quieres hacer?</h1>
          {(easyPacks.length > 0 || services.length > 0) && (
            <div className="easy__quick">
              {easyPacks.length > 0 && (
                <button type="button" className="easy__quickbtn" onClick={() => { buzz(); setStep("packs"); }}>
                  <b>🎁 Packs listos</b>
                  <small>Varias cosas en una visita</small>
                </button>
              )}
              <button type="button" className="easy__quickbtn" onClick={() => { buzz(); setQuizStep(0); setQuizAns({}); setStep("quiz"); }}>
                <b>🎀 Haz el test</b>
                <small>¿No sabes qué elegir? 20 segundos</small>
              </button>
            </div>
          )}
          <div className="easy__list">
            {categories.map((c) => {
              const Icon = iconFor(c);
              return (
                <button key={c} type="button" className="easy__btn easy__btn--tile" onClick={() => { buzz(); setCategory(c); setStep("service"); }}>
                  <Icon size={34} aria-hidden="true" /> {c}
                </button>
              );
            })}
          </div>
        </>
      )}

      {step === "packs" && (
        <>
          <Back />
          <h1 className="easy__h">🎁 Packs listos</h1>
          <p className="easy__sub">Varias cosas en una sola visita.</p>
          <div className="easy__list">
            {easyPacks.map(({ p, list }) => {
              const full = list.reduce((a, x) => a + x.priceCents, 0);
              const price = list.reduce((a, x) => a + discounted(x.priceCents, p.discountPercent), 0);
              return (
                <button key={p.id} type="button" className="easy__btn easy__btn--row" onClick={() => pickList(list, p, "packs")}>
                  <span>
                    <b>{p.emoji} {p.name}</b>
                    <small>{list.map((x) => x.name).join(" + ")}</small>
                    <small>{fmtDuration(list.reduce((a, x) => a + x.durationMin, 0))}{p.featured ? " · ⭐ Destacado" : ""}</small>
                  </span>
                  <span className="easy__price">
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
          <Back />
          {quizId === null ? (
            <>
              <p className="easy__sub">Pregunta {quizStep + 1} de 3</p>
              <h1 className="easy__h">{getDict()[QUIZ[quizStep].q]}</h1>
              <div className="easy__list">
                {QUIZ[quizStep].opts.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="easy__btn easy__btn--tile"
                    onClick={() => {
                      buzz();
                      setQuizAns({ ...quizAns, [QUIZ[quizStep].field]: id as Time | Style | QuizLast });
                      setQuizStep(quizStep + 1);
                    }}
                  >
                    {getDict()[label]}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1 className="easy__h">🎀 {getDict()[RESULT_KEY[quizId][0]]}</h1>
              <p>{getDict()[RESULT_KEY[quizId][1]]}</p>
              <p className="easy__sub">{getDict()[TIP_KEY[(quizAns as QuizAnswers).style]]}</p>
              <button
                type="button"
                className="easy__btn easy__btn--main"
                onClick={() => {
                  const list = quizServices(quizId, services.map((x) => x.slug)).map((sl) => services.find((x) => x.slug === sl)).filter((x): x is Service => !!x);
                  if (list.length) pickList(list, null, "quiz");
                }}
              >
                Pedir esto
              </button>
              <button type="button" className="easy__btn easy__btn--soft" onClick={() => { setQuizStep(0); setQuizAns({}); }}>
                Repetir el test
              </button>
            </>
          )}
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
                  setFrom("service");
                  setSlots(null);
                  setDay(null);
                  setShowAllDays(false);
                  setStep("day");
                }}
              >
                <span><b>{s.name}</b><small>{fmtDuration(s.durationMin)}{s.waitMin ? ` · incluye ${s.waitMin} min de pose` : ""}</small></span>
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
              <WaitlistForm serviceId={service.id} serviceIds={service.ids} day={null} source="app" startOpen />
              <CallbackForm initialName={profile?.name ?? ""} initialPhone={profile?.phone ?? ""} />
            </>
          )}
          <div className="easy__list">
            {(showAllDays ? days : days.slice(0, 6)).map((d) => (
              <button key={d} type="button" className="easy__btn easy__btn--tile" onClick={() => { buzz(); setDay(d); setStep("time"); }}>
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
            <WaitlistForm key={day} serviceId={service.id} serviceIds={service.ids} day={day} dayLabel={dayLabel(day)} source="app" startOpen={times.length === 0} />
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
              <input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => { setOtpAsk(null); setOtp(""); setForm({ ...form, phone: e.target.value }); }} placeholder="600 123 456" />
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
            <button type="submit" className="easy__btn easy__btn--main" disabled={busy || !allAcked}>
              {busy ? "Un momento…" : otpAsk ? "Verificar y confirmar" : depositEnabled && knownDeposit > 0 ? `Pagar señal de ${fmtPrice(knownDeposit)}` : "Confirmar mi cita"}
            </button>
            <p className="easy__legal">Al confirmar, Pro Diva usará tus datos para gestionar tu cita y enviarte la confirmación y un recordatorio por WhatsApp o SMS. Si no terminas, te escribiremos una sola vez por si quieres retomarla. <a href="/privacidad">Privacidad</a></p>
          </form>
        </>
      )}

      {step === "done" && done && (
        <section className="easy__done">
          <button type="button" className="easy__back easy__back--left" onClick={back}>
            <ArrowLeft size={26} aria-hidden="true" /> Volver al menú
          </button>
          <PetalBurst />
          <span className="easy__tick"><Check size={56} aria-hidden="true" /></span>
          <h1 className="easy__h">¡Cita confirmada!</h1>
          <p className="easy__when">{fmtLong(done.startsAt)}</p>
          <p>{done.serviceName}</p>
          <p className="easy__sub">El mismo día te escribiremos para que confirmes con un toque.</p>
          <a
            className="easy__btn easy__btn--soft"
            href={icsHref({ code: done.code, title: `${done.serviceName} en Pro Diva`, startsAt: done.startsAt, endsAt: done.endsAt, location: address })}
            download={`cita-prodiva-${done.code}.ics`}
          >
            <CalendarPlus size={26} aria-hidden="true" /> Añadir al calendario
          </a>
          <a className="easy__btn easy__btn--soft" href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <MapPin size={26} aria-hidden="true" /> Cómo llegar
          </a>
          <p className="muted">{address}</p>
          <button
            type="button"
            className="easy__btn easy__btn--main"
            onClick={() => {
              restart();
              setStep("category");
            }}
          >
            Pedir otra cita
          </button>
          <button type="button" className="easy__btn easy__btn--soft" onClick={restart}>Ver mis citas</button>
        </section>
      )}
      </div>
    </div>
  );
}
