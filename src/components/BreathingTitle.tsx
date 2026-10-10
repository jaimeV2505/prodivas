"use client";

import { useRef, type CSSProperties, type PointerEvent } from "react";
import { useReducedMotion } from "framer-motion";

type Props = { words: string[]; accent?: number[] };

/**
 * Titular del hero. Entrada: las palabras aparecen con un fundido suave (de borroso a nítido, subiendo un poco).
 * Con el ratón: un brillo rosa muy suave se desliza por las palabras en magenta ("Pro Diva,"). En móvil y con
 * "reducir movimiento" se queda quieto.
 */
export default function BreathingTitle({ words, accent = [] }: Props) {
  const reduce = useReducedMotion();
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  const target = useRef<number[]>([]);
  const cur = useRef<number[]>([]);
  const raf = useRef(0);

  const tick = () => {
    let moving = false;
    for (const i of accent) {
      const el = els.current[i];
      if (!el) continue;
      const c = cur.current[i] ?? 50;
      const t = target.current[i] ?? 50;
      const n = c + (t - c) * 0.07; // se acerca despacio: movimiento suave
      cur.current[i] = n;
      el.style.setProperty("--glow", `${n.toFixed(1)}%`);
      if (Math.abs(t - n) > 0.3) moving = true;
    }
    raf.current = moving ? requestAnimationFrame(tick) : 0;
  };
  const go = () => {
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  };

  function move(e: PointerEvent<HTMLHeadingElement>) {
    if (reduce || e.pointerType !== "mouse") return;
    for (const i of accent) {
      const el = els.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      target.current[i] = Math.max(-20, Math.min(120, ((e.clientX - r.left) / r.width) * 100));
    }
    go();
  }
  function leave() {
    for (const i of accent) target.current[i] = 50;
    go();
  }

  return (
    <h1 className="hero__title" onPointerMove={move} onPointerLeave={leave}>
      {words.map((w, i) => (
        <span key={i}>
          <span className={`hero__word ${accent.includes(i) ? "hero__word--accent" : ""}`}>
            <span
              ref={(el) => {
                els.current[i] = el;
              }}
              style={{ ["--i" as string]: i } as CSSProperties}
            >
              {w}
            </span>
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </h1>
  );
}
