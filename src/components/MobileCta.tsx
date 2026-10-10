"use client";

import { useState } from "react";
import { useMotionValueEvent, useScroll } from "framer-motion";
import { MessageCircle } from "lucide-react";
import TransitionLink from "./TransitionLink";

/** Barra inferior en móvil: reservar o escribir por WhatsApp, siempre al alcance del pulgar. */
export default function MobileCta({ whatsapp }: { whatsapp: string }) {
  const { scrollY } = useScroll();
  const [on, setOn] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setOn(y > 420));
  return (
    <div className={`mcta ${on ? "is-on" : ""}`}>
      <TransitionLink href="/reservar" className="btn btn--primary btn--lg mcta__main">Reservar cita</TransitionLink>
      <a className="mcta__wa" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">
        <MessageCircle size={26} aria-hidden="true" />
      </a>
    </div>
  );
}
