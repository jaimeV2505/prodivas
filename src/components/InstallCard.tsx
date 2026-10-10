"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void> };

/** Registra el service worker y ofrece "Instalar en mi móvil" (Android) o las instrucciones de iPhone. */
export default function InstallCard() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone) return null;

  return (
    <section className="easy__install" aria-label="Instalar la aplicación">
      <h2>Ten la app en tu móvil</h2>
      <p>Un icono en tu pantalla de inicio para pedir cita con un toque.</p>
      {evt ? (
        <button type="button" className="easy__btn easy__btn--soft" onClick={() => void evt.prompt()}>
          <Download size={26} aria-hidden="true" /> Instalar en mi móvil
        </button>
      ) : ios ? (
        <p className="easy__steps">
          En Safari pulsa <Share size={20} aria-hidden="true" className="easy__inline" /> <b>Compartir</b> y después <b>Añadir a pantalla de inicio</b>.
        </p>
      ) : (
        <p className="easy__steps">En el menú del navegador (los tres puntos) elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.</p>
      )}
    </section>
  );
}
