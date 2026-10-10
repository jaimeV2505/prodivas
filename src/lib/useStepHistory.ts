import { useCallback, useEffect, useRef } from "react";

/**
 * Enlaza los pasos de un flujo con el historial del navegador: el botón "Atrás" del móvil (o del
 * navegador) vuelve al paso anterior en lugar de salir de la página.
 *
 *  - `goBack` pasa al paso anterior y devuelve true si ha cambiado de paso.
 *  - La función devuelta es para los botones "Atrás" visibles: usa el historial si hay pasos acumulados.
 */
export function useStepHistory(step: string, goBack: () => boolean): () => void {
  const idx = useRef(0); // posición actual dentro de los pasos que hemos apilado
  const first = useRef(true);
  const popping = useRef(false); // el cambio de paso viene de un "atrás": no hay que apilar otro
  const goBackRef = useRef(goBack);

  useEffect(() => {
    goBackRef.current = goBack;
  });

  // Cada cambio de paso (que no venga de un "atrás") añade una entrada al historial
  useEffect(() => {
    if (first.current) {
      first.current = false;
      window.history.replaceState({ ...(window.history.state ?? {}), pdStep: 0 }, "");
      return;
    }
    if (popping.current) {
      popping.current = false;
      return;
    }
    idx.current += 1;
    window.history.pushState({ pdStep: idx.current }, "");
  }, [step]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const to = typeof e.state?.pdStep === "number" ? (e.state.pdStep as number) : null;
      if (to === null) return;
      if (to < idx.current) {
        idx.current = to;
        popping.current = goBackRef.current();
      } else {
        idx.current = to; // "adelante" del navegador: no rehacemos pasos
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return useCallback(() => {
    if (idx.current > 0) window.history.back();
    else goBackRef.current();
  }, []);
}
