"use client";

import type { ElementType } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Props = { text: string; as?: "h1" | "h2" | "h3" | "p"; className?: string };

/** Titular cuyas palabras suben desde una máscara cuando entran en pantalla (una sola vez). */
export default function RevealText({ text, as = "h2", className }: Props) {
  const reduce = useReducedMotion();
  const Tag = as as ElementType;
  return (
    <Tag className={className} aria-label={text}>
      {text.split(" ").map((w, i, all) => (
        <span key={i}>
        <span className="rt__mask" aria-hidden="true">
          <motion.span
            className="rt__word"
            initial={reduce ? false : { transform: "translateY(110%)" }}
            whileInView={{ transform: "translateY(0%)" }}
            viewport={{ once: true, margin: "0px 0px -12% 0px" }}
            transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1], delay: i * 0.06 }}
          >
            {w}
          </motion.span>
        </span>
        {i < all.length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}
