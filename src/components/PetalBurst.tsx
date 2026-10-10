"use client";

import { motion, useReducedMotion } from "framer-motion";

const N = 24;

/** Estallido de pétalos al confirmar la cita (momento raro y de celebración). */
export default function PetalBurst() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div className="burst" aria-hidden="true">
      {Array.from({ length: N }).map((_, i) => {
        const a = (i / N) * Math.PI * 2;
        const d = 110 + ((i * 37) % 120);
        return (
          <motion.span
            key={i}
            className={`burst__petal burst__petal--${i % 3}`}
            initial={{ opacity: 1, transform: "translate(0px, 0px) rotate(0deg) scale(0.6)" }}
            animate={{
              opacity: 0,
              transform: `translate(${Math.round(Math.cos(a) * d)}px, ${Math.round(Math.sin(a) * d + 50)}px) rotate(${(i * 47) % 360}deg) scale(1)`,
            }}
            transition={{ duration: 1.1, ease: [0.23, 1, 0.32, 1], delay: 0.2 }}
          />
        );
      })}
    </div>
  );
}
