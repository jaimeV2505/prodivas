"use client";

import { useState } from "react";
import { useMotionValueEvent, useScroll } from "framer-motion";
import { MessageCircle, Smartphone } from "lucide-react";
import TransitionLink from "./TransitionLink";

/** Barra inferior en móvil: pedir cita fácil (el gancho) o escribir por WhatsApp, siempre al alcance del pulgar. */
export default function MobileCta({ whatsapp }: { whatsapp: string }) {
  const { scrollY } = useScroll();
  const [on, setOn] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setOn(y > 420));
  return (
    <div className={`mcta ${on ? "is-on" : ""}`}>
      <TransitionLink href="/cita" className="btn btn--primary btn--lg mcta__main"><Smartphone size={22} aria-hidden="true" /> Pedir cita fácil</TransitionLink>
      <a className="mcta__wa" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">
        <MessageCircle size={26} aria-hidden="true" />
      </a>
    </div>
  );
}
