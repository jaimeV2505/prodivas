"use client";

import { useState } from "react";
import { useMotionValueEvent, useScroll } from "framer-motion";
import Link from "next/link";
import TransitionLink from "./TransitionLink";

export default function SiteHeader() {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);

  // Se esconde al bajar y reaparece al subir
  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(y > prev && y > 160);
    setSolid(y > 24);
  });

  return (
    <header className={`site-header ${solid ? "is-solid" : ""} ${hidden ? "is-hidden" : ""}`}>
      <div className="container site-header__in">
        <TransitionLink href="/" className="wordmark" aria-label="Pro Diva, inicio">
          <span className="wordmark__pro">Pro</span>
          <span className="wordmark__diva">Diva</span>
        </TransitionLink>
        <nav aria-label="Principal" className="site-nav">
          <Link href="/#servicios" className="site-nav__link">Servicios</Link>
          <Link href="/#donde" className="site-nav__link">Dónde estamos</Link>
          <TransitionLink href="/reservar" className="btn btn--primary btn--sm">Reservar cita</TransitionLink>
        </nav>
      </div>
    </header>
  );
}
