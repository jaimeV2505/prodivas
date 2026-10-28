/**
 * Medición del embudo, anónima y sin cookies de terceros (solo navegador).
 *  - Sin consentimiento: el identificador de sesión vive solo en memoria (nada se guarda en el dispositivo).
 *  - Con consentimiento («pd_consent» = yes): la sesión y las UTM sobreviven entre páginas.
 * Nunca se envía nombre, teléfono ni email: solo el paso, el servicio y de dónde viene la visita.
 */
export type FunnelEvent = "landing" | "service" | "slots" | "hold" | "details" | "lead" | "confirmed";
export type Attribution = { sid: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; ref?: string; referrer?: string };

const CONSENT_KEY = "pd_consent";
const STORE_KEY = "pd_attr";

let mem: Attribution | null = null;
const sent = new Set<string>();

export function getConsent(): "yes" | "no" | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "yes" || v === "no" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(v: "yes" | "no"): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, v);
    if (v === "no") window.localStorage.removeItem(STORE_KEY);
    else if (mem) window.localStorage.setItem(STORE_KEY, JSON.stringify(mem));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Quién es esta visita y de dónde viene (las UTM y el código de amiga de la URL mandan sobre lo guardado). */
export function attribution(): Attribution {
  if (typeof window === "undefined") return { sid: "ssr" };
  if (!mem) {
    let stored: Attribution | null = null;
    if (getConsent() === "yes") {
      try {
        stored = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "null") as Attribution | null;
      } catch {
        stored = null;
      }
    }
    mem = stored && stored.sid ? stored : { sid: rid() };
  }
  const p = new URLSearchParams(window.location.search);
  let changed = false;
  for (const k of ["utm_source", "utm_medium", "utm_campaign"] as const) {
    const v = p.get(k);
    if (v && mem[k] !== v.slice(0, 60)) {
      mem[k] = v.slice(0, 60);
      changed = true;
    }
  }
  const ref = p.get("ref");
  if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref) && mem.ref !== ref.toUpperCase()) {
    mem.ref = ref.toUpperCase();
    changed = true;
  }
  if (!mem.referrer && document.referrer) {
    try {
      const h = new URL(document.referrer).hostname;
      if (h && h !== window.location.hostname) {
        mem.referrer = h.slice(0, 80);
        changed = true;
      }
    } catch {
      /* referrer raro */
    }
  }
  if (changed && getConsent() === "yes") {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(mem));
    } catch {
      /* nada */
    }
  }
  return mem;
}

/** Registra un paso del embudo (sin esperar respuesta). `once` evita repetir el mismo paso en la misma visita. */
export function track(event: FunnelEvent, opts: { flow?: "full" | "easy" | "hero"; services?: string[]; meta?: Record<string, unknown>; once?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  const a = attribution();
  const key = `${event}:${opts.flow ?? ""}:${(opts.services ?? []).join(",")}`;
  if (opts.once !== false && sent.has(key)) return;
  sent.add(key);
  const body = JSON.stringify({
    sid: a.sid,
    event,
    flow: opts.flow,
    services: (opts.services ?? []).join(",").slice(0, 200) || undefined,
    utm_source: a.utm_source,
    utm_medium: a.utm_medium,
    utm_campaign: a.utm_campaign,
    referrer: a.referrer,
    device: window.matchMedia?.("(max-width: 760px)").matches ? "mobile" : "desktop",
    meta: opts.meta,
  });
  try {
    void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* la medición nunca debe romper la reserva */
  }
}
