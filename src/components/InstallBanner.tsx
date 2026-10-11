"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void> };
type Env = "ios" | "inapp" | "other";

/**
 * Invitación a instalar la app (solo el módulo de pedir cita) en la pantalla de inicio. Sale arriba, cada vez que se
 * entra al «pedir cita fácil» desde el navegador; una vez instalada y abierta como app, ya no sale.
 *  - Android / Chrome: un botón «Instalar» que abre el aviso del propio móvil.
 *  - iPhone (Safari): las dos pulsaciones que hay que hacer, porque iOS no deja instalar con un botón.
 *  - Navegador de Instagram, Facebook o TikTok: no se puede instalar desde ahí; se le dice que lo abra en su navegador.
 * «Ahora no» solo la esconde en esta visita: la próxima vez que pida cita fácil, vuelve a salir.
 */
export default function InstallBanner() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(true); // por defecto «ya instalada»: así no parpadea antes de comprobarlo
  const [env, setEnv] = useState<Env>("other");
  const [steps, setSteps] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const ua = navigator.userAgent;
    setEnv(/FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|Line\//i.test(ua) ? "inapp" : /iphone|ipad|ipod/i.test(ua) ? "ios" : "other");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || hidden) return null;

  async function install() {
    if (evt) {
      await evt.prompt().catch(() => {});
      setEvt(null);
    } else setSteps((s) => !s);
  }

  return (
    <aside className="installbar" aria-label="Instalar la aplicación">
      <div className="installbar__row">
        <span className="installbar__ico" aria-hidden="true">📲</span>
        <div className="installbar__txt">
          <strong>Ten la app en tu móvil</strong>
          <small>Solo para pedir cita, con un toque</small>
        </div>
        <button type="button" className="installbar__btn" onClick={() => void install()} aria-expanded={evt ? undefined : steps}>
          <Download size={20} aria-hidden="true" /> {evt ? "Instalar" : "Cómo"}
        </button>
        <button type="button" className="installbar__x" onClick={() => setHidden(true)} aria-label="Ahora no">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {steps && !evt && (
        <p className="installbar__steps" role="status">
          {env === "inapp" ? (
            <>Aquí no se puede instalar. Pulsa <b>⋯</b> y elige <b>Abrir en el navegador</b> (Safari o Chrome); allí te saldrá el botón.</>
          ) : env === "ios" ? (
            <>En Safari pulsa <Share size={18} aria-hidden="true" className="installbar__inline" /> <b>Compartir</b> y después <b>Añadir a pantalla de inicio</b>.</>
          ) : (
            <>En el menú del navegador (los tres puntos) elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.</>
          )}
        </p>
      )}
    </aside>
  );
}
