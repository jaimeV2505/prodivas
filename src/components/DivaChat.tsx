"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MessageCircle, Phone, Send, X } from "lucide-react";
import { answer, contextChips, greeting, type AvailAsk, type DivaCard, type DivaCtx, type DivaInfo, type DivaMsg, type Rot } from "@/lib/diva";
import type { AiAction } from "@/lib/divaAi";
import { CONFIG } from "@/lib/config";
import { addDays, todayIn } from "@/lib/dates";
import { fmtShortDay } from "@/lib/format";
import type { Trend } from "@/lib/trends";
import type { Pack, Service } from "./BookingFlow";
import "./diva.css";

/**
 * Diva en formato chat: burbuja flotante + hoja de conversación. Las respuestas con datos exactos (precios, duraciones,
 * horario, huecos reales…) salen siempre del cerebro de reglas (src/lib/diva.ts); si el servidor tiene IA
 * (ANTHROPIC_API_KEY, ver /api/diva) la usa para lo abierto o conversacional y, si falla, vuelve a las reglas.
 */
export type ChatSlot = { day: string; time: string; startsAt: string };
type ChatService = Pick<Service, "slug" | "name" | "category" | "durationMin" | "priceCents"> & Partial<Pick<Service, "id" | "description" | "waitMin">>;

export type DivaChatProps = {
  flow: "easy" | "full";
  services: ChatService[];
  packs?: Pack[] | { slug: string; name: string; serviceSlugs: string[]; discountPercent: number; people?: number }[];
  trends?: Trend[];
  chosenSlugs: string[];
  step?: string;
  /** La clienta pulsa «Reservar esto» (o un hueco) en una respuesta de Diva. `slot` solo viene al pulsar un hueco concreto. */
  onChoose?: (slugs: string[], slot?: ChatSlot) => void;
  /** Control desde fuera (reserva completa): abre/cierra el chat y oculta la burbuja flotante. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideFab?: boolean;
  /** Pregunta que se envía sola al abrir (la reserva completa la usa cuando el avatar no puede contestar con huecos). */
  initialQuestion?: { text: string; nonce: number };
};

type SlotBtn = { label: string; slot: ChatSlot; slugs: string[] };
type Msg = {
  id: number;
  from: "you" | "diva";
  text: string;
  cards?: (DivaCard & { mode?: "book" | "slots"; ask?: AvailAsk })[];
  slots?: SlotBtn[];
  links?: { label: string; href: string }[];
  ai?: boolean;
};

type Info = DivaInfo & { ai?: boolean };
let infoPromise: Promise<Info> | null = null;
export const loadDivaInfo = (): Promise<Info> => (infoPromise ??= fetch("/api/diva").then((r) => (r.ok ? (r.json() as Promise<Info>) : {})).catch(() => ({}) as Info));

const TYPING_MS = 520;

/** `**negrita**` y saltos de línea, sin dejar pasar HTML. */
function rich(text: string): ReactNode {
  return text.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line.split("**").map((part, j) => (j % 2 ? <strong key={j}>{part}</strong> : part))}
    </span>
  ));
}

function MiniDiva() {
  return (
    <svg viewBox="0 0 100 100" className="dchat__face" focusable="false" aria-hidden="true">
      <circle cx="50" cy="50" r="48" className="dchat-bg" />
      <path className="dchat-hair" d="M22 56 C18 30 34 14 50 14 C68 14 82 30 78 56 C77 72 70 82 64 86 L36 86 C30 82 23 72 22 56 Z" />
      <ellipse className="dchat-skin" cx="50" cy="56" rx="24" ry="27" />
      <path className="dchat-hair" d="M26 52 C26 32 38 22 51 22 C66 22 76 32 74 52 C68 41 60 36 50 36 C40 36 32 41 26 52 Z" />
      <path className="dchat-ribbon" d="M40 20 q10 -7 20 0 q-4 6 -10 6 q-6 0 -10 -6z" />
      <ellipse cx="41" cy="57" rx="2.8" ry="3.8" className="dchat-eye" />
      <ellipse cx="59" cy="57" rx="2.8" ry="3.8" className="dchat-eye" />
      <circle cx="35" cy="66" r="4.6" className="dchat-cheek" />
      <circle cx="65" cy="66" r="4.6" className="dchat-cheek" />
      <path d="M44 68 Q50 74 56 68" className="dchat-mouth" />
    </svg>
  );
}

/** Hasta 3 huecos bien repartidos (varios días o varias horas del mismo día). */
function pickSlots(list: { day: string; time: string; startsAt: string }[], n = 3): ChatSlot[] {
  if (!list.length) return [];
  const days = [...new Set(list.map((s) => s.day))];
  if (days.length > 1) return days.slice(0, n).map((d) => list.find((s) => s.day === d)!);
  if (list.length <= n) return list;
  return [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]];
}

export default function DivaChat({ flow, services, packs = [], trends = [], chosenSlugs, step = "service", onChoose, open: openProp, onOpenChange, hideFab, initialQuestion }: DivaChatProps) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : openState;
  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setOpenState(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [text, setText] = useState("");
  const [info, setInfo] = useState<Info>({});
  const nextId = useRef(1);
  const rot = useRef<Rot>({});
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  useEffect(() => {
    let off = false;
    loadDivaInfo().then((i) => !off && setInfo(i));
    return () => {
      off = true;
    };
  }, []);

  const ctx = useMemo<DivaCtx>(
    () => ({
      trends,
      services: services.map((s) => ({ slug: s.slug, name: s.name, category: s.category, durationMin: s.durationMin, priceCents: s.priceCents, id: s.id, description: s.description, waitMin: s.waitMin })),
      packs: packs.map((p) => ({ slug: p.slug, name: p.name, serviceSlugs: p.serviceSlugs, discountPercent: p.discountPercent, people: p.people })),
      selected: chosenSlugs,
      step,
      address: CONFIG.salon.address,
      today: todayIn(CONFIG.tz),
      info,
    }),
    [trends, services, packs, chosenSlugs, step, info],
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const push = useCallback((m: Omit<Msg, "id">) => {
    setMsgs((l) => [...l, { ...m, id: nextId.current++ }].slice(-40));
    if (m.text) history.current = [...history.current, { role: m.from === "you" ? ("user" as const) : ("assistant" as const), content: m.text }].slice(-12);
  }, []);

  // Abrir: saludo contextual la primera vez, foco en la casilla y sin scroll de fondo
  const greeted = useRef(false);
  useEffect(() => {
    if (!open) return;
    returnTo.current = (document.activeElement as HTMLElement | null) ?? null;
    if (!greeted.current) {
      greeted.current = true;
      push({ from: "diva", text: greeting(ctxRef.current) });
    }
    const prev = document.body.style.overflow;
    if (window.matchMedia("(max-width: 719px)").matches) document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      (returnTo.current ?? fabRef.current)?.focus?.({ preventScroll: true });
    };
  }, [open, push]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [msgs, thinking]);

  // Esc cierra y el foco no se escapa de la hoja
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab" || !sheetRef.current) return;
    const f = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const idOf = useCallback((slug: string) => ctxRef.current.services.find((s) => s.slug === slug)?.id ?? ctxRef.current.info?.services?.[slug]?.id, []);
  const nameOf = (slug: string) => ctxRef.current.services.find((s) => s.slug === slug)?.name ?? slug;

  const dayWord = (day: string) => {
    const t = ctxRef.current.today ?? todayIn(CONFIG.tz);
    return day === t ? "Hoy" : day === addDays(t, 1) ? "Mañana" : fmtShortDay(day);
  };

  /** Huecos reales: consulta la disponibilidad y los ofrece como botones. */
  const showSlots = useCallback(
    async (ask: AvailAsk) => {
      const slugs = ask.slugs;
      if (!slugs.length) {
        // sin servicio claro: se le pide que elija uno (con un botón «Ver huecos» en cada tarjeta)
        const c = ctxRef.current;
        const pool = c.selected.length ? [] : c.services.slice(0, 3);
        push({
          from: "diva",
          text: pool.length ? "¡Claro! ¿Para qué servicio te busco hueco? 👇" : "Dime para qué servicio y te busco hueco 💖",
          cards: pool.map((s) => ({ slug: s.slug, kind: "service" as const, title: s.name, meta: "", mode: "slots" as const, ask })),
        });
        return;
      }
      const ids = slugs.map(idOf);
      const names = slugs.map(nameOf).join(" + ");
      if (ids.some((x) => !x)) {
        push({ from: "diva", text: `Para ${names} te enseño los huecos en cuanto lo elijas 💖`, links: [{ label: "Ver huecos", href: `/reservar?servicio=${slugs[0]}` }] });
        return;
      }
      const today = ctxRef.current.today ?? todayIn(CONFIG.tz);
      const query = async (from: string, days: number) => {
        const qs = new URLSearchParams({ serviceIds: ids.join(","), from, to: addDays(from, Math.max(0, days - 1)) });
        const r = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
        if (!r.ok) throw new Error("bad");
        return ((await r.json()) as { slots: { day: string; time: string; startsAt: string; available: boolean }[] }).slots.filter((s) => s.available);
      };
      const byPart = <T extends { time: string }>(l: T[]): T[] => (ask.part === "any" ? l : l.filter((s) => (ask.part === "morning" ? Number(s.time.slice(0, 2)) < 15 : Number(s.time.slice(0, 2)) >= 15)));
      try {
        let list = byPart(await query(ask.day < today ? today : ask.day, ask.days));
        let label = ask.label;
        let found = list.length > 0;
        let later = false;
        if (!found) {
          // el siguiente día con hueco
          const wide = await query(ask.day < today ? today : ask.day, 21);
          const next = byPart(wide)[0] ?? wide[0];
          if (next) {
            list = wide.filter((s) => s.day === next.day);
            label = dayWord(next.day).toLowerCase();
            found = true;
            later = true;
          }
        }
        if (!found) {
          push({
            from: "diva",
            text: `Ahora mismo no veo huecos libres para ${names} en los próximos días 🙈 Puedes apuntarte a la lista de espera al elegir el día (te avisamos si se libera) o llamarnos al ${CONFIG.salon.phoneMobile}.`,
            links: [{ label: "Apuntarme en la lista", href: `/reservar?servicio=${slugs[0]}` }, { label: `Llamar ${CONFIG.salon.phoneMobile}`, href: `tel:${CONFIG.salon.phoneE164}` }],
          });
          return;
        }
        const picks = pickSlots(list);
        push({
          from: "diva",
          text: later ? `${ask.label[0].toUpperCase()}${ask.label.slice(1)} no me queda hueco para ${names} 🙈 El siguiente libre es ${label}:` : `Para ${names} ${ask.label} tengo estos huecos libres 📅`,
          slots: picks.map((s) => ({ label: `${dayWord(s.day)} · ${s.time}`, slot: { day: s.day, time: s.time, startsAt: s.startsAt }, slugs })),
        });
      } catch {
        push({ from: "diva", text: `No he podido mirar los huecos ahora mismo 🙈 Pruébalo en el calendario o llámanos al ${CONFIG.salon.phoneMobile}.` });
      }
    },
    [idOf, push],
  );

  const sayRules = useCallback(
    async (r: DivaMsg) => {
      if (r.ask) return showSlots(r.ask);
      push({ from: "diva", text: r.text, cards: r.cards, links: r.links });
    },
    [push, showSlots],
  );

  const applyAction = useCallback(
    async (a: AiAction | null) => {
      if (!a) return;
      const c = ctxRef.current;
      if (a.kind === "reservar") {
        const cards = a.slugs.map((slug) => c.services.find((s) => s.slug === slug)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ slug: s.slug, kind: "service" as const, title: s.name, meta: `${s.durationMin} min · ${(s.priceCents / 100).toFixed(0)} €` }));
        if (cards.length) push({ from: "diva", text: "", cards });
      } else {
        const t = c.today ?? todayIn(CONFIG.tz);
        const day = a.dia === "hoy" ? t : a.dia === "manana" ? addDays(t, 1) : a.dia === "pasado" ? addDays(t, 2) : a.dia;
        await showSlots({ day, days: 1, part: "any", label: a.dia === "hoy" ? "hoy" : a.dia === "manana" ? "mañana" : "ese día", slugs: [a.slug] });
      }
    },
    [push, showSlots],
  );

  async function ask(raw: string) {
    const q = raw.trim().slice(0, 200);
    if (!q || thinking) return;
    push({ from: "you", text: q });
    setThinking(true);
    const started = Date.now();
    const wait = async () => {
      const left = TYPING_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
    };
    try {
      const r = answer(q, ctxRef.current, rot.current);
      // Datos exactos o huecos: reglas. Lo abierto o desconocido: IA si el servidor la tiene.
      if (r.ask || r.exact || !info.ai) {
        await wait();
        await sayRules(r);
        return;
      }
      try {
        const res = await fetch("/api/diva", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.current.slice(-12), context: { chosen: ctxRef.current.selected } }),
        });
        const j = (await res.json()) as { ok?: boolean; text?: string; action?: AiAction | null };
        if (j.ok && j.text) {
          await wait();
          push({ from: "diva", text: j.text, ai: true });
          await applyAction(j.action ?? null);
          return;
        }
      } catch {
        /* sin IA: se sigue con las reglas */
      }
      await wait();
      await sayRules(r);
    } finally {
      setThinking(false);
    }
  }

  // Pregunta que llega desde fuera: se envía una sola vez al abrir
  const lastNonce = useRef(0);
  useEffect(() => {
    if (!open || !initialQuestion || initialQuestion.nonce === lastNonce.current) return;
    lastNonce.current = initialQuestion.nonce;
    const t = setTimeout(() => void ask(initialQuestion.text), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuestion?.nonce]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = text;
    setText("");
    void ask(q);
  }

  const choose = (slugs: string[], slot?: ChatSlot) => {
    if (onChoose && !(slot && flow === "full")) {
      onChoose(slugs, slot);
      push({ from: "diva", text: slot ? "¡Perfecto! Te lo dejo elegido 💖" : "¡Hecho! Lo dejo elegido 💖" });
      setTimeout(() => setOpen(false), 650);
      return;
    }
    const qs = new URLSearchParams({ servicio: slugs[0] });
    if (slugs.length > 1) qs.set("extra", slugs.slice(1).join(","));
    if (slot) {
      qs.set("dia", slot.day);
      qs.set("hora", slot.time);
    }
    window.location.assign(`/reservar?${qs}`);
  };

  const cardGo = (c: Msg["cards"] extends (infer U)[] | undefined ? U : never) => {
    if (c.mode === "slots" && c.ask) return void showSlots({ ...c.ask, slugs: [c.slug] });
    if (c.kind === "pack") {
      const p = ctxRef.current.packs.find((x) => x.slug === c.slug);
      return choose(p?.serviceSlugs.length ? [...new Set(p.serviceSlugs)] : [c.slug]);
    }
    choose([c.slug]);
  };

  const chips = contextChips(step, chosenSlugs.length);
  const phone = CONFIG.salon.phoneMobile;

  return (
    <>
      {!hideFab && !open && (
        <button ref={fabRef} type="button" className={`dchat__fab dchat__fab--${flow}`} onClick={() => setOpen(true)} aria-label="Hablar con Diva, tu asistente de belleza" aria-haspopup="dialog">
          <MiniDiva />
          <span className="dchat__fab-txt">Pregunta a Diva</span>
        </button>
      )}
      {open && (
        <div className="dchat__layer">
          <div className="dchat__backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={sheetRef} className="dchat" role="dialog" aria-modal="true" aria-label="Chat con Diva" onKeyDown={onKeyDown}>
            <header className="dchat__head">
              <MiniDiva />
              <div className="dchat__who">
                <strong>Diva</strong>
                <span>tu asistente de belleza{info.ai ? " · con IA" : ""}</span>
              </div>
              <button type="button" className="dchat__x" onClick={() => setOpen(false)} aria-label="Cerrar el chat">
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="dchat__list" ref={listRef} role="log" aria-live="polite" aria-relevant="additions text">
              {msgs.map((m) => (
                <div key={m.id} className={`dchat__row dchat__row--${m.from}`}>
                  {m.text && (
                    <p className={`dchat__bubble dchat__bubble--${m.from}`}>
                      {rich(m.text)}
                      {m.ai && <small className="dchat__ai">✨ Diva IA</small>}
                    </p>
                  )}
                  {m.cards?.map((c) => (
                    <div key={c.slug + (c.mode ?? "")} className="dchat__card">
                      <div className="dchat__card-t">
                        <strong>{c.title}</strong>
                        {c.meta && <span>{c.meta}</span>}
                        {c.note && <em>{c.note}</em>}
                      </div>
                      <button type="button" className="dchat__go" onClick={() => cardGo(c)}>
                        {c.mode === "slots" ? "Ver huecos" : "Reservar esto"}
                      </button>
                    </div>
                  ))}
                  {m.slots && (
                    <div className="dchat__slots">
                      {m.slots.map((s) => (
                        <button key={s.slot.startsAt} type="button" className="dchat__slot" onClick={() => choose(s.slugs, s.slot)}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.links && (
                    <div className="dchat__links">
                      {m.links.map((l) => (
                        <a key={l.href} href={l.href} className="dchat__link" {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                          {l.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {thinking && (
                <div className="dchat__row dchat__row--diva">
                  <p className="dchat__bubble dchat__bubble--diva dchat__typing" aria-label="Diva está escribiendo">
                    <i /><i /><i />
                  </p>
                </div>
              )}
            </div>

            <div className="dchat__chips" aria-label="Preguntas rápidas">
              {chips.map((c) => (
                <button key={c.label} type="button" className="dchat__chip" onClick={() => void ask(c.q)} disabled={thinking}>
                  {c.label}
                </button>
              ))}
            </div>

            <form className="dchat__form" onSubmit={submit}>
              <label className="sr-only" htmlFor="dchat-q">Escríbele a Diva</label>
              <input ref={inputRef} id="dchat-q" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Escríbele a Diva…" autoComplete="off" enterKeyHint="send" />
              <button type="submit" className="dchat__send" disabled={!text.trim() || thinking} aria-label="Enviar">
                <Send size={18} aria-hidden="true" />
              </button>
            </form>

            <footer className="dchat__foot">
              <a href={`tel:${CONFIG.salon.phoneE164}`}><Phone size={15} aria-hidden="true" /> Llamar {phone}</a>
              <a href={`https://wa.me/${CONFIG.salon.whatsapp}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} aria-hidden="true" /> WhatsApp</a>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
