"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion, useScroll } from "framer-motion";
import { Lock } from "lucide-react";
import RevealText from "./RevealText";

const TIMES = ["10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30", "11:45"];
// Guion de la demo: qué hueco tiene "la clienta" y cuáles ocupan otras personas
const SCRIPT: { mine: number | null; taken: number[] }[] = [
  { mine: 1, taken: [2, 5] },
  { mine: 4, taken: [2, 5] },
  { mine: 4, taken: [2, 5, 6] },
  { mine: null, taken: [2, 5, 6, 4] },
  { mine: 0, taken: [2, 5, 6, 4] },
  { mine: 0, taken: [2, 5, 6, 4, 3] },
];

function LiveSlots() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setI((x) => (x + 1) % SCRIPT.length), 1700);
    return () => clearInterval(id);
  }, [inView, reduce]);

  const { mine, taken } = SCRIPT[i];
  return (
    <div ref={ref} className="demo" role="img" aria-label="Demostración: al elegir un hueco queda bloqueado y otras personas ya no pueden cogerlo.">
      <p className="demo__day">Martes 14 de octubre</p>
      <div className="slots__grid" aria-hidden="true">
        {TIMES.map((t, k) => {
          const isMine = mine === k;
          const isTaken = taken.includes(k);
          return (
            <span key={t} className={`slot ${isMine ? "slot--mine" : ""} ${isTaken ? "slot--taken" : ""}`}>
              {isMine && (
                <motion.span
                  key={`${i}-${k}`}
                  className="slot__lock"
                  initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", duration: 0.35, bounce: 0.2 }}
                >
                  <Lock size={13} />
                </motion.span>
              )}
              {isTaken && <Lock size={12} className="slot__lock--taken" />}
              {t}
            </span>
          );
        })}
      </div>
      <div className="demo__bar" aria-hidden="true">
        <i key={mine ?? "none"} className={mine === null ? "" : "is-running"} />
      </div>
    </div>
  );
}

const STEPS = (hold: number) => [
  { t: "Elige tu servicio", d: "Manicura, pestañas, depilación o microblading, con duración y precio a la vista." },
  { t: "Escoge un hueco libre", d: `Lo bloqueamos ${hold} minutos para ti. Nadie más puede cogerlo mientras terminas.` },
  { t: "Confirma con tu teléfono", d: "Recibes un código y un enlace por si necesitas cancelar." },
];

export default function HowItWorks({ holdMinutes }: { holdMinutes: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });

  return (
    <div className="container how">
      <div>
        <RevealText as="h2" text="Reservar es así de fácil" className="section__title" />
        <ol className="steps" ref={ref}>
          {!reduce && <motion.i className="steps__line" style={{ scaleY: scrollYProgress }} aria-hidden="true" />}
          {STEPS(holdMinutes).map((s, k) => (
            <motion.li
              key={s.t}
              className="steps__item"
              initial={reduce ? false : { opacity: 0, transform: "translateY(24px)" }}
              whileInView={{ opacity: 1, transform: "translateY(0px)" }}
              viewport={{ once: true, margin: "0px 0px -15% 0px" }}
              transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1], delay: k * 0.05 }}
            >
              <span className="steps__n" aria-hidden="true">{k + 1}</span>
              <div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
      <LiveSlots />
    </div>
  );
}
