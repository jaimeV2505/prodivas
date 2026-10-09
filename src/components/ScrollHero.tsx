"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import Petals from "./Petals";

const FRAME_COUNT = Number(process.env.NEXT_PUBLIC_HERO_FRAMES ?? 90);
const frameSrc = (i: number) => `/frames/frame_${String(i).padStart(4, "0")}.webp`;

const WORDS = ["Tu", "cita", "en", "Pro", "Diva,", "sin", "llamar."];

function HeroCopy({ animate }: { animate: boolean }) {
  return (
    <>
      <h1 className="hero__title" aria-label={WORDS.join(" ")}>
        {WORDS.map((w, i) => (
          <span className="hero__word" key={i} aria-hidden="true">
            <motion.span
              initial={animate ? { y: "110%" } : false}
              animate={{ y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 + i * 0.07, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {w}
            </motion.span>
          </span>
        ))}
      </h1>
      <motion.p
        className="hero__lead"
        initial={animate ? { opacity: 0, y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.6 }}
      >
        Manicura, pedicura, pestañas, depilación y microblading en Melide. Elige servicio y hueco:
        queda bloqueado para ti mientras reservas.
      </motion.p>
      <motion.div
        className="hero__cta"
        initial={animate ? { opacity: 0, y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.05, duration: 0.6 }}
      >
        <Link href="/reservar" className="btn btn--primary btn--lg">Reservar cita</Link>
        <Link href="/#servicios" className="btn btn--ghost btn--lg">Ver servicios y precios</Link>
      </motion.div>
    </>
  );
}

export default function ScrollHero() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"probe" | "frames" | "static">("probe");

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });
  const introOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const introY = useTransform(scrollYProgress, [0, 0.2], [0, -40]);
  const outroOpacity = useTransform(scrollYProgress, [0.62, 0.84], [0, 1]);
  const outroY = useTransform(scrollYProgress, [0.62, 0.84], [40, 0]);

  // ¿Hay fotogramas generados en /public/frames? Si no, hero estático con pétalos.
  useEffect(() => {
    if (reduce) {
      setMode("static");
      return;
    }
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => !cancelled && setMode("frames");
    probe.onerror = () => !cancelled && setMode("static");
    probe.src = frameSrc(1);
    return () => {
      cancelled = true;
    };
  }, [reduce]);

  // Scrubbing: el scroll decide qué fotograma se pinta en el canvas
  useEffect(() => {
    if (mode !== "frames") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imgs: HTMLImageElement[] = [];
    let target = 0;
    let raf = 0;

    const render = () => {
      raf = 0;
      const img = imgs[target];
      if (!img || !img.complete || !img.naturalWidth) return;
      const cw = canvas.width;
      const ch = canvas.height;
      const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      schedule();
    };

    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.onload = () => {
        if (i === target) schedule();
      };
      img.src = frameSrc(i + 1);
      imgs.push(img);
    }

    resize();
    window.addEventListener("resize", resize);
    const unsub = scrollYProgress.on("change", (v) => {
      target = Math.min(FRAME_COUNT - 1, Math.max(0, Math.round(v * (FRAME_COUNT - 1))));
      schedule();
    });

    return () => {
      window.removeEventListener("resize", resize);
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode, scrollYProgress]);

  const scrub = mode === "frames";

  return (
    <section
      ref={sectionRef}
      className={`hero ${scrub ? "hero--scrub" : "hero--static"}`}
      aria-label="Presentación de Pro Diva"
    >
      {scrub ? (
        <div className="hero__stick">
          <canvas ref={canvasRef} className="hero__canvas" aria-hidden="true" />
          <div className="hero__veil" />
          <motion.div className="hero__copy" style={{ opacity: introOpacity, y: introY }}>
            <HeroCopy animate />
          </motion.div>
          <motion.div className="hero__copy hero__copy--outro" style={{ opacity: outroOpacity, y: outroY }}>
            <p className="hero__outro">Elige tu hueco. Lo guardamos para ti.</p>
            <Link href="/reservar" className="btn btn--primary btn--lg">Reservar cita</Link>
          </motion.div>
        </div>
      ) : (
        <>
          <Petals />
          <div className="container">
            <div className="hero__copy hero__copy--static">
              <HeroCopy animate={mode === "static" && !reduce} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
