"use client";

import { Check } from "lucide-react";
import { POLISH, type Polish } from "@/lib/polish";

type Props = { value: Polish | null; onChange: (p: Polish) => void };

// Dedos: [centro x, y de la punta, alto]. Pulgar aparte (rotado).
const FINGERS: [number, number, number][] = [
  [128, 112, 200],
  [176, 76, 236],
  [224, 100, 212],
  [272, 152, 160],
];

/** Mano en SVG: al elegir un esmalte, las uñas cambian de color en ola. */
export default function HandPolish({ value, onChange }: Props) {
  const shown = value?.hex ?? POLISH[0].hex;
  return (
    <div className="hand">
      <svg viewBox="0 0 360 440" className="hand__svg" role="img" aria-label={`Mano con esmalte ${value?.name ?? POLISH[0].name}`}>
        <g className="hand__skin">
          {FINGERS.map(([cx, top, h], i) => (
            <rect key={i} x={cx - (i === 3 ? 18 : 20)} y={top} width={i === 3 ? 36 : 40} height={h} rx={i === 3 ? 18 : 20} />
          ))}
          <g transform="rotate(-38 84 372)">
            <rect x="62" y="262" width="40" height="150" rx="20" />
          </g>
          <rect x="96" y="236" width="196" height="196" rx="82" />
        </g>
        {FINGERS.map(([cx, top], i) => (
          <g key={i} className="hand__nail" style={{ ["--d" as string]: `${i * 70}ms` } as React.CSSProperties}>
            <rect x={cx - (i === 3 ? 14 : 16)} y={top + 9} width={i === 3 ? 28 : 32} height={i === 3 ? 38 : 46} rx="14" style={{ fill: shown }} />
            <ellipse key={shown} className="hand__gloss" cx={cx - 5} cy={top + 25} rx="3.5" ry="10" fill="#fff" opacity=".45" />
          </g>
        ))}
        <g transform="rotate(-38 84 372)" className="hand__nail" style={{ ["--d" as string]: "280ms" } as React.CSSProperties}>
          <rect x="66" y="270" width="32" height="44" rx="14" style={{ fill: shown }} />
          <ellipse key={shown} className="hand__gloss" cx="76" cy="286" rx="3.5" ry="10" fill="#fff" opacity=".45" />
        </g>
      </svg>

      <div className="hand__picker" role="radiogroup" aria-label="Elige tu color de esmalte">
        {POLISH.map((p) => {
          const on = value?.slug === p.slug;
          return (
            <button
              key={p.slug}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={p.name}
              title={p.name}
              className={`swatch ${on ? "is-on" : ""}`}
              style={{ background: p.hex }}
              onClick={() => onChange(p)}
            >
              {on && <Check size={18} aria-hidden="true" className="swatch__tick" />}
            </button>
          );
        })}
      </div>
      <p className="hand__name" aria-live="polite">
        {value ? <>Tu color: <b>{value.name}</b></> : "Elige tu color"}
      </p>
    </div>
  );
}
