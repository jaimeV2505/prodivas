"use client";

import { useRef, type CSSProperties, type PointerEvent } from "react";
import { useReducedMotion } from "framer-motion";

type Props = { words: string[]; accent?: number[] };

/**
 * Titular que "respira": al mover el ratón, las palabras cercanas se engrosan y las lejanas se afinan
 * (eje de grosor de la fuente variable). En táctil y con "reducir movimiento" se queda quieto.
 */
export default function BreathingTitle({ words, accent = [] }: Props) {
  const reduce = useReducedMotion();
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const raf = useRef(0);

  function move(e: PointerEvent<HTMLHeadingElement>) {
    if (reduce || e.pointerType !== "mouse") return;
    const { clientX: x, clientY: y } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      for (const el of refs.current) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        const k = Math.max(0, 1 - d / 280);
        el.style.fontVariationSettings = `"wght" ${Math.round(520 + 280 * k)}`;
      }
    });
  }
  function leave() {
    cancelAnimationFrame(raf.current);
    for (const el of refs.current) if (el) el.style.fontVariationSettings = "";
  }

  return (
    <h1 className="hero__title" onPointerMove={move} onPointerLeave={leave}>
      {words.map((w, i) => (
        <span key={i}>
          <span className={`hero__word ${accent.includes(i) ? "hero__word--accent" : ""}`}>
            <span
              ref={(el) => {
                refs.current[i] = el;
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
