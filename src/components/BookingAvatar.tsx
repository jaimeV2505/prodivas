"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { answer, contextChips, nextTrend, spontaneous, type DivaAction, type DivaCtx, type DivaInfo, type DivaMsg, type Rot } from "@/lib/diva";
import { CONFIG } from "@/lib/config";
import { todayIn } from "@/lib/dates";
import { fill, getDict } from "@/lib/i18n";
import type { Trend } from "@/lib/trends";
import DivaChat, { loadDivaInfo } from "./DivaChat";

/**
 * Diva, la chica que reserva contigo. Reacciona al paso en el que vas, habla sola de vez en cuando
 * (tendencias y consejos según lo que has elegido) y contesta a lo que le preguntes. Puede añadir un
 * servicio a tu cita con un toque. Sin IA ni servicios externos: ver src/lib/diva.ts.
 * Colores de piel y pelo en variables CSS (--skin, --hair…) en globals.css.
 */
export type AvatarState = "browse" | "held" | "typing" | "done";
type Result = "added" | "chosen" | "already" | "full" | "missing";
type Line = { from: "you" | "diva"; text: string; action?: DivaAction; used?: boolean; links?: { label: string; href: string }[] };

type Props = {
  state: AvatarState;
  trends: Trend[];
  services: { slug: string; name: string; category: string; durationMin: number; priceCents: number }[];
  packs: { slug: string; name: string; serviceSlugs: string[]; discountPercent: number; people?: number }[];
  selected: string[];
  step: string;
  address: string;
  /** Hay visitas anteriores guardadas en este móvil: Diva da la bienvenida. */
  history: boolean;
  onAdd: (slug: string, kind: "service" | "pack") => Result;
};

const IDLE_MS = 24000; // cada cuánto habla sola
const MAX_SPONTANEOUS = 6; // y cuántas veces seguidas sin que le contesten

export default function BookingAvatar({ state, trends, services, packs, selected, step, address, history, onAdd }: Props) {
  const T = getDict();
  const STATE_MSG: Record<AvatarState, string> = { browse: T.divaStateBrowse, held: T.divaStateHeld, typing: T.divaStateTyping, done: T.divaStateDone };
  const ADDED: Record<Result, string> = { added: T.divaAdded, chosen: T.divaChosen, already: T.divaAlready, full: T.divaFull, missing: T.divaMissing };
  const [log, setLog] = useState<Line[]>([{ from: "diva", text: T.divaStateBrowse }]);
  const [thinking, setThinking] = useState(false);
  const [talking, setTalking] = useState(false);
  const [cheer, setCheer] = useState(false);
  const [text, setText] = useState("");
  const rot = useRef<Rot>({});
  const [chatOpen, setChatOpen] = useState(false);
  const [question, setQuestion] = useState<{ text: string; nonce: number } | undefined>();
  const [info, setInfo] = useState<DivaInfo>({});
  const spoken = useRef(0);
  const lastTouch = useRef(Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // El contexto cambia a cada paso: se lee siempre el último desde una referencia
  const ctxRef = useRef<DivaCtx>({ trends, services, packs, selected, step, address });
  ctxRef.current = { trends, services, packs, selected, step, address, today: todayIn(CONFIG.tz), info };
  useEffect(() => {
    let off = false;
    void loadDivaInfo().then((i) => !off && setInfo(i));
    return () => {
      off = true;
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const say = (m: DivaMsg) => {
    setLog((l) => [...l, { from: "diva" as const, text: m.text, action: m.action, links: m.links }].slice(-8));
    setTalking(true);
    later(() => setTalking(false), Math.min(2600, 700 + m.text.length * 22));
  };

  // Cambia el paso de la reserva: Diva lo comenta
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    lastTouch.current = Date.now();
    spoken.current = 0;
    say({ text: STATE_MSG[state] });
    if (state === "done") {
      setCheer(true);
      later(() => setCheer(false), 3200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Bienvenida a quien ya ha reservado antes desde este móvil (solo una vez, y solo mientras elige)
  const welcomed = useRef(false);
  useEffect(() => {
    if (!history || welcomed.current || state !== "browse") return;
    welcomed.current = true;
    let name = "";
    try {
      name = (JSON.parse(localStorage.getItem("pd_profile") ?? "{}") as { name?: string }).name?.split(" ")[0] ?? "";
    } catch {
      /* sin perfil */
    }
    say({ text: name ? fill(T.divaReturn, { name }) : T.divaFriendly });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  // Habla sola de vez en cuando (tendencias y consejos), salvo cuando está escribiendo sus datos o ya terminó
  useEffect(() => {
    if (state === "typing" || state === "done") return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastTouch.current < IDLE_MS - 1000) return;
      if (spoken.current >= MAX_SPONTANEOUS) return;
      spoken.current += 1;
      say(spontaneous(ctxRef.current, rot.current));
    }, IDLE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function ask(q: string) {
    const t = q.trim().slice(0, 200);
    if (!t || thinking) return;
    lastTouch.current = Date.now();
    spoken.current = 0;
    setLog((l) => [...l, { from: "you" as const, text: t }].slice(-8));
    setThinking(true);
    later(() => {
      setThinking(false);
      const r = answer(t, ctxRef.current, rot.current);
      if (r.ask) {
        // los huecos reales se ven en el chat completo
        say({ text: "Te los miro ahora mismo en el chat, con huecos reales 📅" });
        setQuestion({ text: t, nonce: Date.now() });
        setChatOpen(true);
        return;
      }
      say(r);
    }, 520);
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    ask(text);
    setText("");
  }
  function act(i: number) {
    const line = log[i];
    if (!line?.action || line.used) return;
    lastTouch.current = Date.now();
    const r = onAdd(line.action.slug, line.action.kind);
    setLog((l) => l.map((x, j) => (j === i ? { ...x, used: r === "added" || r === "chosen" || r === "already" } : x)));
    say({ text: ADDED[r] });
    if (r === "added" || r === "chosen") {
      setCheer(true);
      later(() => setCheer(false), 2200);
    }
  }
  // Una tendencia al pulsar el avatar (como tocarle el hombro)
  function poke() {
    lastTouch.current = Date.now();
    say(nextTrend(ctxRef.current, rot.current));
  }

  // Solo se ven la última pregunta y la última respuesta
  const lastDivaIdx = (() => {
    for (let i = log.length - 1; i >= 0; i--) if (log[i].from === "diva") return i;
    return 0;
  })();
  const lastYouIdx = log.length - 1 > lastDivaIdx ? log.length - 1 : lastDivaIdx > 0 && log[lastDivaIdx - 1]?.from === "you" ? lastDivaIdx - 1 : -1;
  const diva = log[lastDivaIdx];

  return (
    <section className={`avatar avatar--${state} ${talking || thinking ? "avatar--talking" : ""} ${cheer ? "avatar--cheer" : ""}`} aria-label={T.divaRegion}>
      <div className="avatar__chat" aria-live="polite">
        {lastYouIdx >= 0 && log[lastYouIdx].from === "you" && <p className="avatar__you">{log[lastYouIdx].text}</p>}
        {thinking ? (
          <p className="avatar__bubble avatar__bubble--typing" aria-label={T.divaTyping}>
            <i /><i /><i />
          </p>
        ) : (
          <p className="avatar__bubble" key={lastDivaIdx}>
            <span className="avatar__name">{T.divaName}</span>
            {diva.text}
          </p>
        )}
        {!thinking && diva.links?.map((l) => (
          <a key={l.href} className="avatar__act" href={l.href} {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {l.label}
          </a>
        ))}
        {!thinking && diva.action && !diva.used && (
          <button type="button" className="avatar__act" onClick={() => act(lastDivaIdx)}>
            + {diva.action.label}
          </button>
        )}
      </div>

      <button type="button" className="avatar__poke" onClick={poke} aria-label={T.divaPoke}>
        <AvatarArt />
      </button>

      <div className="avatar__ask">
        <div className="avatar__chips">
          {contextChips(step, selected.length, state === "done").slice(0, 4).map((c) => (
            <button key={c.label} type="button" className="avatar__chip" onClick={() => ask(c.q)} disabled={thinking}>
              {c.label}
            </button>
          ))}
        </div>
        <form className="avatar__form" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="diva-q">{T.divaAsk}</label>
          <input id="diva-q" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={T.divaPlaceholder} autoComplete="off" enterKeyHint="send" />
          <button type="submit" className="avatar__send" disabled={!text.trim() || thinking}>{T.divaSend}</button>
        </form>
        <button type="button" className="avatar__chatbtn" onClick={() => setChatOpen(true)}>
          ✨ Pregúntale a Diva · chat con huecos reales
        </button>
      </div>
      <DivaChat
        flow="full"
        hideFab
        open={chatOpen}
        onOpenChange={setChatOpen}
        services={services}
        packs={packs}
        trends={trends}
        chosenSlugs={selected}
        step={step}
        initialQuestion={question}
        onChoose={(slugs) => {
          for (const slug of slugs) onAdd(slug, "service");
        }}
      />
    </section>
  );
}

function AvatarArt() {
  return (
    <svg viewBox="0 0 300 320" className="avatar__svg" focusable="false" aria-hidden="true">
      <circle cx="150" cy="170" r="122" className="av-blob" />
      <circle cx="236" cy="70" r="9" className="av-dot av-dot--a" />
      <circle cx="52" cy="110" r="6" className="av-dot av-dot--b" />

      {/* chispas */}
      <path className="av-spark av-spark--1" d="M258 118 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4z" />
      <path className="av-spark av-spark--2" d="M44 196 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" />
      <path className="av-spark av-spark--3" d="M72 62 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" />

      <g className="av-person">
        {/* pelo de atrás */}
        <path className="av-hair" d="M100 172 C92 112 126 88 150 88 C176 88 210 110 200 172 C198 206 188 222 176 230 L124 230 C112 222 102 206 100 172 Z" />
        {/* cuerpo y cuello */}
        <path className="av-blouse" d="M64 320 C64 262 98 240 150 240 C202 240 236 262 236 320 Z" />
        <path className="av-collar" d="M130 242 L150 268 L170 242 Z" />
        <rect className="av-skin" x="137" y="206" width="26" height="42" rx="11" />
        <ellipse className="av-skin-shade" cx="150" cy="222" rx="12" ry="6" />
        {/* cabeza */}
        <ellipse className="av-skin" cx="150" cy="170" rx="40" ry="46" />
        <circle className="av-hair" cx="150" cy="84" r="21" />
        <path className="av-ribbon" d="M133 98 q17 -9 34 0 q-6 7 -17 7 q-11 0 -17 -7z" />
        <path className="av-hair" d="M108 162 C108 122 132 106 152 106 C176 106 194 124 192 162 C180 142 166 130 148 130 C130 130 116 142 108 162 Z" />
        <circle cx="111" cy="186" r="3.2" className="av-pearl" />
        <circle cx="189" cy="186" r="3.2" className="av-pearl" />
        {/* cara */}
        <path className="av-brow" d="M126 163 Q135 157 144 161" />
        <path className="av-brow" d="M156 161 Q165 157 174 163" />
        <g className="av-eyes">
          <ellipse cx="135" cy="174" rx="4.6" ry="6.2" className="av-eye" />
          <ellipse cx="165" cy="174" rx="4.6" ry="6.2" className="av-eye" />
          <circle cx="136.6" cy="171.8" r="1.5" className="av-shine" />
          <circle cx="166.6" cy="171.8" r="1.5" className="av-shine" />
        </g>
        <circle cx="124" cy="190" r="8" className="av-cheek" />
        <circle cx="176" cy="190" r="8" className="av-cheek" />
        <path className="av-mouth av-mouth--small" d="M140 194 Q150 203 160 194" />
        <path className="av-mouth av-mouth--big" d="M137 192 Q150 210 163 192 Q150 198 137 192 Z" />

        {/* brazo y móvil */}
        <g className="av-phone-group">
          <path className="av-blouse" d="M204 250 C226 246 240 262 236 292 L212 306 L192 296 Z" />
          <g transform="rotate(-8 224 262)">
            <rect x="182" y="196" width="86" height="128" rx="15" className="av-phone" />
            <rect x="190" y="210" width="70" height="104" rx="8" className="av-screen" />
            <rect x="213" y="201" width="24" height="4" rx="2" className="av-notch" />
            <g className="av-scr av-scr--browse">
              <rect x="190" y="210" width="70" height="17" rx="8" className="av-screen-head" />
              {Array.from({ length: 12 }).map((_, i) => (
                <circle key={i} cx={202 + (i % 4) * 16} cy={242 + Math.floor(i / 4) * 17} r="5.6" className={`av-day av-day--${i % 3}`} />
              ))}
              <circle cx="218" cy="259" r="7" className="av-day-pick" />
            </g>
            <g className="av-scr av-scr--held">
              <rect x="190" y="210" width="70" height="17" rx="8" className="av-screen-head" />
              <circle cx="225" cy="268" r="24" className="av-ok" />
              <path d="M213 268 l8 9 l16 -18" className="av-check" />
            </g>
            <g className="av-scr av-scr--typing">
              <rect x="190" y="210" width="70" height="17" rx="8" className="av-screen-head" />
              <rect x="198" y="238" width="54" height="9" rx="4.5" className="av-line" />
              <rect x="198" y="256" width="54" height="9" rx="4.5" className="av-line" />
              <rect x="198" y="274" width="34" height="9" rx="4.5" className="av-line av-line--active" />
              <circle cx="212" cy="298" r="3" className="av-type av-type--1" />
              <circle cx="224" cy="298" r="3" className="av-type av-type--2" />
              <circle cx="236" cy="298" r="3" className="av-type av-type--3" />
            </g>
            <g className="av-scr av-scr--done">
              <rect x="190" y="210" width="70" height="17" rx="8" className="av-screen-head" />
              <circle cx="225" cy="268" r="26" className="av-ok" />
              <path d="M212 268 l9 10 l18 -20" className="av-check" />
            </g>
          </g>
          <ellipse cx="190" cy="300" rx="9" ry="15" transform="rotate(-8 190 300)" className="av-skin" />
          <ellipse cx="253" cy="322" rx="9" ry="7" className="av-skin av-tap" />
        </g>
      </g>

      {/* corazones al confirmar o al añadir algo */}
      <path className="av-heart av-heart--1" d="M70 150 c-6 -9 -18 -2 -10 8 l10 10 10 -10 c8 -10 -4 -17 -10 -8z" />
      <path className="av-heart av-heart--2" d="M248 168 c-5 -7 -14 -1 -8 6 l8 8 8 -8 c6 -7 -3 -13 -8 -6z" />
    </svg>
  );
}
