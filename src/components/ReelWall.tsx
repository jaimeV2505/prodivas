"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Instagram } from "lucide-react";
import MediaSlot from "./MediaSlot";
import RevealText from "./RevealText";

const TILES = [
  { name: "reel-1", range: ["10%", "-8%"] },
  { name: "reel-2", range: ["-8%", "12%"] },
  { name: "reel-3", range: ["16%", "-6%"] },
] as const;

function Tile({ name, range, progress, reduce }: { name: string; range: readonly [string, string]; progress: ReturnType<typeof useScroll>["scrollYProgress"]; reduce: boolean }) {
  const y = useTransform(progress, [0, 1], [range[0], range[1]]);
  return (
    <motion.div className="wall__tile" style={reduce ? undefined : { y }}>
      <MediaSlot name={name} variant="reel" />
    </motion.div>
  );
}

/** Tres vídeos verticales (tipo reel) que se desplazan a distinta velocidad al hacer scroll. */
export default function ReelWall({ instagram }: { instagram: string }) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });

  return (
    <div className="container" ref={ref}>
      <div className="wall__head">
        <RevealText as="h2" text="Mira cómo queda" className="section__title" />
        <a className="btn btn--ghost" href={`https://www.instagram.com/${instagram}/`} target="_blank" rel="noopener noreferrer">
          <Instagram size={18} aria-hidden="true" /> @{instagram}
        </a>
      </div>
      <div className="wall">
        {TILES.map((t) => (
          <Tile key={t.name} name={t.name} range={t.range} progress={scrollYProgress} reduce={reduce} />
        ))}
      </div>
    </div>
  );
}
