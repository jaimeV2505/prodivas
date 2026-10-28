"use client";

import { VIDEOS } from "@/lib/videos.generated";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { ArrowRight, Check, MapPin, MessageCircle, Phone, Smartphone } from "lucide-react";
import { HERO_PHOTO } from "@/lib/media";
import Art from "./Art";
import BreathingTitle from "./BreathingTitle";
import HeroPhoto from "./HeroPhoto";
import HeroBooker, { type HeroService } from "./HeroBooker";
import Petals from "./Petals";
import TransitionLink from "./TransitionLink";

export type HeroContact = { address: string; mapsUrl: string; phone: string; whatsapp: string };

const WORDS = ["Tu", "cita", "en", "Pro", "Diva,", "sin", "llamar."];

/** El gancho: pedir cita fácil (3 toques, sin registrarte, instalable como app). */
function EasyCta({ className = "", short = false }: { className?: string; short?: boolean }) {
  return (
    <TransitionLink href="/cita" className={`easycta ${className}`}>
      <span className="easycta__ico" aria-hidden="true"><Smartphone size={26} /></span>
      <span className="easycta__txt">
        <b>Pedir cita fácil</b>
        <small>{short ? "3 toques · sin registrarte" : "3 toques · sin registrarte · instálala como app"}</small>
      </span>
      <ArrowRight size={22} aria-hidden="true" className="easycta__arrow" />
    </TransitionLink>
  );
}

/**
 * Hero compacto: todo en la primera pantalla, sin hacer scroll.
 *  - Izquierda: titular, una línea de texto, mini-reserva con huecos reales y garantías.
 *  - Derecha (escritorio): el gancho «Pedir cita fácil» y los datos de contacto. En el móvil, el gancho sube justo bajo el titular.
 * Fondo: /videos/hero.mp4 si existe; si no, fondo animado con pétalos.
 */
export default function Hero({ services, today, contact }: { services: HeroService[]; today: string; contact: HeroContact }) {
  const reduce = useReducedMotion();
  const [video, setVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (reduce || !VIDEOS.includes("hero")) return;
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
          <HeroPhoto color={null} variant="full" />
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
          <p className="hero__lead">Manicura, pedicura, pestañas, depilación y microblading en Melide.</p>
          <EasyCta className="easycta--mobile" />
          <HeroBooker services={services.slice(0, 4)} today={today} />
          <ul className="hero__trust">
            <li><Check size={16} aria-hidden="true" /> Sin registrarte</li>
            <li><Check size={16} aria-hidden="true" /> Hueco guardado mientras reservas</li>
            <li><Check size={16} aria-hidden="true" /> Cancelas con un toque</li>
          </ul>
        </div>
        <aside className="hero2__right" aria-label="Pedir cita fácil y contacto">
          <div className="hookcard">
            <EasyCta className="easycta--card" short />
            <p className="hookcard__txt">Una pregunta por pantalla y botones grandes. Instálala en tu móvil y pide cita con un toque.</p>
            <ul className="hookcard__list">
              <li><MapPin size={18} aria-hidden="true" /> <a href={contact.mapsUrl} target="_blank" rel="noopener noreferrer">{contact.address}</a></li>
              <li><Phone size={18} aria-hidden="true" /> <a href={`tel:+34${contact.phone.replace(/\s/g, "")}`}>{contact.phone}</a></li>
              <li><MessageCircle size={18} aria-hidden="true" /> <a href={`https://wa.me/${contact.whatsapp}`} target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a></li>
            </ul>
            <p className="hookcard__more"><Link href="/#servicios">Ver precios</Link></p>
          </div>
        </aside>
      </div>
    </section>
  );
}
