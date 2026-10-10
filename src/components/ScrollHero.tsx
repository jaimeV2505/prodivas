"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Check } from "lucide-react";
import Art from "./Art";
import Magnetic from "./Magnetic";
import Petals from "./Petals";
import RotatingBadge from "./RotatingBadge";
import TransitionLink from "./TransitionLink";
import Link from "next/link";

const FRAME_COUNT = Number(process.env.NEXT_PUBLIC_HERO_FRAMES ?? 90);
const frameSrc = (i: number) => `/frames/frame_${String(i).padStart(4, "0")}.webp`;
const WORDS = ["Tu", "cita", "en", "Pro", "Diva,", "sin", "llamar."];

export type NextSlot = { label: string; href: string };

function HeroCopy({ nextSlots }: { nextSlots: NextSlot[] }) {
  return (
    <>
      <h1 className="hero__title">
        {WORDS.map((w, i) => (
          <span key={i}>
            <span className="hero__word">
              <span style={{ ["--i" as string]: i } as React.CSSProperties}>{w}</span>
            </span>
            {i < WORDS.length - 1 ? " " : null}
          </span>
        ))}
      </h1>
      <p className="hero__lead">
        Manicura, pedicura, pestañas, depilación y microblading en Melide. Elige servicio y hueco:
        queda bloqueado para ti mientras reservas.
      </p>
      <div className="hero__cta">
        <Magnetic>
          <TransitionLink href="/reservar" className="btn btn--primary btn--lg">Reservar cita</TransitionLink>
        </Magnetic>
        <Link href="/#servicios" className="btn btn--ghost btn--lg">Ver servicios y precios</Link>
      </div>
      <ul className="hero__trust">
        <li><Check size={16} aria-hidden="true" /> Sin registrarte</li>
        <li><Check size={16} aria-hidden="true" /> Hueco guardado mientras reservas</li>
        <li><Check size={16} aria-hidden="true" /> Aviso el mismo día, cancelas con un toque</li>
      </ul>
      {nextSlots.length > 0 && (
        <div className="hero__slots">
          <span className="hero__slots-label"><i className="live" aria-hidden="true" /> Próximos huecos libres</span>
          {nextSlots.map((c) => (
            <TransitionLink key={c.href} href={c.href} className="chip">{c.label}</TransitionLink>
          ))}
        </div>
      )}
      <p className="hero__easy">¿Prefieres algo más sencillo? <TransitionLink href="/cita">Pedir cita en modo fácil</TransitionLink></p>
    </>
  );
}

type Mode = "probe" | "frames" | "video" | "static";

/**
 * Hero con tres niveles, del más rico al más sencillo:
 *  1. /public/frames/frame_0001.webp...  → el vídeo avanza con el scroll
 *  2. /public/videos/hero.mp4            → vídeo de fondo en bucle
 *  3. nada                               → fondo animado con pétalos
 */
export default function ScrollHero({ nextSlots = [] }: { nextSlots?: NextSlot[] }) {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("probe");

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });
  const introOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const introY = useTransform(scrollYProgress, [0, 0.2], [0, -40]);
  const outroOpacity = useTransform(scrollYProgress, [0.62, 0.84], [0, 1]);
  const outroY = useTransform(scrollYProgress, [0.62, 0.84], [40, 0]);

  useEffect(() => {
    if (reduce) {
      setMode("static");
      return;
    }
    let off = false;
    const probe = new Image();
    probe.onload = () => !off && setMode("frames");
    probe.onerror = () => {
      fetch("/videos/hero.mp4", { method: "HEAD" })
        .then((r) => !off && setMode(r.ok && (r.headers.get("content-type") ?? "").includes("video") ? "video" : "static"))
        .catch(() => !off && setMode("static"));
    };
    probe.src = frameSrc(1);
    return () => {
      off = true;
    };
  }, [reduce]);

  // Modo fotogramas: el scroll decide qué fotograma se pinta
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

  // Modo vídeo: solo suena (se reproduce) mientras el hero está en pantalla
  useEffect(() => {
    const v = videoRef.current;
    if (mode !== "video" || !v) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? void v.play().catch(() => {}) : v.pause()), {
      threshold: 0.15,
    });
    io.observe(v);
    return () => io.disconnect();
  }, [mode]);

  const scrub = mode === "frames";

  // Un único bloque de texto en todos los modos: así la animación de entrada no se reinicia
  return (
    <section
      ref={sectionRef}
      className={`hero ${scrub ? "hero--scrub" : ""}`}
      aria-label="Presentación de Pro Diva"
    >
      <div className={scrub ? "hero__stick" : "hero__flat"}>
        {mode === "frames" && (
          <>
            <canvas ref={canvasRef} className="hero__canvas" aria-hidden="true" />
            <div className="hero__veil" />
          </>
        )}
        {mode === "video" && (
          <>
            <video
              ref={videoRef}
              className="hero__video"
              src="/videos/hero.mp4"
              poster="/videos/hero.jpg"
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
            />
            <div className="hero__veil" />
          </>
        )}
        {(mode === "probe" || mode === "static") && (
          <>
            <Art variant="hero" />
            <Petals />
          </>
        )}

        <motion.div
          className={`hero__copy ${scrub ? "" : "hero__copy--static"}`}
          style={scrub ? { opacity: introOpacity, y: introY } : undefined}
        >
          <HeroCopy nextSlots={nextSlots} />
        </motion.div>

        <div className="hero__badge"><RotatingBadge /></div>

        {scrub && (
          <motion.div className="hero__copy hero__copy--outro" style={{ opacity: outroOpacity, y: outroY }}>
            <p className="hero__outro">Elige tu hueco. Lo guardamos para ti.</p>
            <TransitionLink href="/reservar" className="btn btn--primary btn--lg">Reservar cita</TransitionLink>
          </motion.div>
        )}
      </div>
    </section>
  );
}
