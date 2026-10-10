"use client";

import { useState, type FormEvent } from "react";
import { Bell, Check } from "lucide-react";

type Props = {
  serviceId: number;
  day: string | null;
  dayLabel?: string;
  source: "web" | "app";
  startOpen?: boolean;
};

/** "Avísame si se libera un hueco": nombre + teléfono, sin cuenta. */
export default function WaitlistForm({ serviceId, day, dayLabel, source, startOpen = false }: Props) {
  const easy = source === "app";
  const [open, setOpen] = useState(startOpen);
  const [form, setForm] = useState({ name: "", phone: "", email: "", part: "ANY", website: "" });
  const [state, setState] = useState<"idle" | "busy" | "ok">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, day, part: form.part, name: form.name, phone: form.phone, email: form.email, source, website: form.website }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? "No hemos podido apuntarte. Inténtalo de nuevo.");
        setState("idle");
        return;
      }
      setState("ok");
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
      setState("idle");
    }
  }

  if (state === "ok") {
    return (
      <div className={`wl wl--ok ${easy ? "wl--easy" : ""}`} role="status">
        <Check size={easy ? 34 : 22} aria-hidden="true" />
        <p><b>¡Apuntada!</b> Si se libera un hueco, te avisaremos por mensaje.</p>
      </div>
    );
  }

  const what = day ? (dayLabel ?? "ese día") : "cualquier día de las próximas dos semanas";

  return (
    <div className={`wl ${easy ? "wl--easy" : ""}`}>
      {!open ? (
        <button type="button" className={easy ? "easy__btn easy__btn--soft" : "wl__open"} onClick={() => setOpen(true)}>
          <Bell size={easy ? 26 : 18} aria-hidden="true" /> {day ? "¿No hay hueco a tu hora? Avísame si se libera" : "Avísame si se libera un hueco"}
        </button>
      ) : (
        <form onSubmit={submit} className={easy ? "easy__form" : "wl__form"}>
          <p className="wl__what">Te avisamos si se libera un hueco para <b>{what}</b>.</p>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          <label className={easy ? "easy__field" : "field"}>
            <span>Tu nombre</span>
            <input required autoComplete="name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className={easy ? "easy__field" : "field"}>
            <span>Tu teléfono</span>
            <input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="600 123 456" />
          </label>
          <label className={easy ? "easy__field" : "field"}>
            <span>Email <em>(opcional)</em></span>
            <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className={easy ? "easy__field" : "field"}>
            <span>¿A qué hora te viene bien?</span>
            <select value={form.part} onChange={(e) => setForm({ ...form, part: e.target.value })}>
              <option value="ANY">Cualquier hora</option>
              <option value="MORNING">Por la mañana</option>
              <option value="AFTERNOON">Por la tarde</option>
            </select>
          </label>
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <button type="submit" className={easy ? "easy__btn easy__btn--main" : "btn btn--primary btn--block"} disabled={state === "busy"}>
            {state === "busy" ? "Apuntando…" : "Avísame"}
          </button>
          <p className={easy ? "easy__legal" : "muted small"}>Solo te escribiremos si se libera un hueco. Al apuntarte aceptas que Pro Diva use tu nombre y teléfono para ese aviso.</p>
        </form>
      )}
    </div>
  );
}
