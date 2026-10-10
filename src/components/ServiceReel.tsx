"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { fmtDuration, fmtPrice } from "@/lib/format";
import MediaSlot from "./MediaSlot";
import RevealText from "./RevealText";
import TransitionLink from "./TransitionLink";
import type { ArtVariant } from "./Art";

export type ReelItem = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
};
export type ReelGroup = { category: string; items: ReelItem[] };

const MEDIA: { name: string; variant: ArtVariant }[] = [
  { name: "nails", variant: "nails" },
  { name: "eyes", variant: "eyes" },
  { name: "wax", variant: "wax" },
];

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 960px) and (min-height: 640px)");
    const f = () => setWide(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return wide;
}

/**
 * Servicios como carrusel horizontal anclado: al bajar con el scroll, los paneles pasan de lado a lado.
 * En móvil, pantallas bajas o con "reducir movimiento" se apilan como una lista normal.
 */
export default function ServiceReel({ groups }: { groups: ReelGroup[] }) {
  const reduce = useReducedMotion();
  const wide = useWide();
  const pinned = wide && !reduce;
  const ref = useRef<HTMLDivElement>(null);
  const n = groups.length;

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], ["0%", `${-((n - 1) / n) * 100}%`]);

  return (
    <div
      ref={ref}
      className={pinned ? "reel reel--pinned" : "reel reel--stack container"}
      style={pinned ? { height: `${n * 100}vh` } : undefined}
    >
      <div className={pinned ? "reel__stick" : undefined}>
        <motion.div className="reel__track" style={pinned ? { x, width: `${n * 100}vw` } : undefined}>
          {groups.map((g, i) => {
            const m = MEDIA[i % MEDIA.length];
            return (
              <article className="reel__panel" key={g.category}>
                <div className="reel__media"><MediaSlot name={m.name} variant={m.variant} /></div>
                <div className="reel__body">
                  <RevealText as="h3" text={g.category} className="reel__title" />
                  <ul className="reel__list">
                    {g.items.map((s) => (
                      <li key={s.id}>
                        <TransitionLink href={`/reservar?servicio=${s.slug}`} className="reel__row">
                          <span className="reel__row-main">
                            <strong>{s.name}</strong>
                            <small>{fmtDuration(s.durationMin)}{s.description ? `. ${s.description}` : ""}</small>
                          </span>
                          <span className="reel__price">{fmtPrice(s.priceCents)}</span>
                          <ArrowRight size={18} aria-hidden="true" className="reel__arrow" />
                        </TransitionLink>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </motion.div>
        {pinned && <motion.i className="reel__bar" style={{ scaleX: scrollYProgress }} aria-hidden="true" />}
      </div>
    </div>
  );
}
