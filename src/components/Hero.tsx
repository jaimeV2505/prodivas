"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { HERO_PHOTO } from "@/lib/media";
import type { Polish } from "@/lib/polish";
import Art from "./Art";
import BreathingTitle from "./BreathingTitle";
import HandPolish from "./HandPolish";
import HeroPhoto from "./HeroPhoto";
import HeroBooker, { type HeroService } from "./HeroBooker";
import Petals from "./Petals";
import RotatingBadge from "./RotatingBadge";
import TransitionLink from "./TransitionLink";

const WORDS = ["Tu", "cita", "en", "Pro", "Diva,", "sin", "llamar."];

/**
 * Hero: titular que respira + mini-reserva con huecos reales + mano para elegir el color del esmalte.
 * Fondo: /videos/hero.mp4 si existe; si no, fondo animado con pétalos.
 */
export default function Hero({ services, today }: { services: HeroService[]; today: string }) {
  const reduce = useReducedMotion();
  const [color, setColor] = useState<Polish | null>(null);
  const [video, setVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (reduce) return;
    let off = false;
    fetch("/videos/hero.mp4", { method: "HEAD" })
      .then((r) => !off && setVideo(r.ok && (r.headers.get("content-type") ?? "").includes("video")))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [reduce]);

  useEffect(() => {
    const v = videoRef.current;
    if (!video || !v) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.15 });
    io.observe(v);
    return () => io.disconnect();
  }, [video]);

  return (
    <section className={`hero2 ${HERO_PHOTO ? "hero2--photo" : ""}`} aria-label="Presentación de Pro Diva">
      <div className="hero2__bg" aria-hidden={HERO_PHOTO ? undefined : true}>
        {HERO_PHOTO ? (
          <HeroPhoto color={color} variant="full" />
        ) : video ? (
          <>
            <video ref={videoRef} className="hero__video" src="/videos/hero.mp4" poster="/videos/hero.jpg" muted loop playsInline preload="auto" />
            <div className="hero__veil" />
          </>
        ) : (
          <>
            <Art variant="hero" />
            <Petals />
          </>
        )}
      </div>

      <div className="container hero2__grid">
        <div className="hero2__left">
          <BreathingTitle words={WORDS} accent={[3, 4]} />
          <p className="hero__lead">
            Manicura, pedicura, pestañas, depilación y microblading en Melide. Mira los huecos libres y reserva con un toque.
          </p>
          <HeroBooker services={services} today={today} color={color} onClearColor={() => setColor(null)} />
          <ul className="hero__trust">
            <li><Check size={16} aria-hidden="true" /> Sin registrarte</li>
            <li><Check size={16} aria-hidden="true" /> Hueco guardado mientras reservas</li>
            <li><Check size={16} aria-hidden="true" /> Aviso el mismo día, cancelas con un toque</li>
          </ul>
          <p className="hero__easy">
            ¿Prefieres algo más sencillo? <TransitionLink href="/cita">Pedir cita en modo fácil</TransitionLink>
            {" · "}
            <Link href="/#servicios">Ver precios</Link>
          </p>
        </div>
        <div className="hero2__right">
          {HERO_PHOTO && (
            <div className="hero2__banner">
              <HeroPhoto color={color} variant="banner" />
            </div>
          )}
          <HandPolish value={color} onChange={setColor} showHand={!HERO_PHOTO} />
        </div>
      </div>

      <div className="hero__badge"><RotatingBadge /></div>
    </section>
  );
}
