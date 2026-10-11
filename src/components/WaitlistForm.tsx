"use client";

import { useState, type FormEvent } from "react";
import { Bell, Check } from "lucide-react";
import { getDict, type Lang } from "@/lib/i18n";

type Props = {
  serviceId: number;
  /** Si la visita lleva varios servicios, todos (el primero es el principal). */
  serviceIds?: number[];
  day: string | null;
  dayLabel?: string;
  source: "web" | "app";
  startOpen?: boolean;
  lang?: Lang;
};

/** "Avísame si se libera un hueco": nombre + teléfono, sin cuenta. */
export default function WaitlistForm({ serviceId, serviceIds, day, dayLabel, source, startOpen = false, lang = "es" }: Props) {
  const T = getDict(lang);
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
        body: JSON.stringify({ serviceIds: serviceIds && serviceIds.length ? serviceIds : [serviceId], day, part: form.part, name: form.name, phone: form.phone, email: form.email, source, website: form.website }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(lang === "es" ? (j?.error?.message ?? T.wlFail) : T.wlFail);
        setState("idle");
        return;
      }
      setState("ok");
    } catch {
      setError(T.noConn);
      setState("idle");
    }
  }

  if (state === "ok") {
    return (
      <div className={`wl wl--ok ${easy ? "wl--easy" : ""}`} role="status">
        <Check size={easy ? 34 : 22} aria-hidden="true" />
        <p><b>{T.wlOkTitle}</b> {T.wlOkBody}</p>
      </div>
    );
  }

  const what = day ? (dayLabel ?? T.wlThatDay) : T.wlAnyDay;

  return (
    <div className={`wl ${easy ? "wl--easy" : ""}`}>
      {!open ? (
        <button type="button" className={easy ? "easy__btn easy__btn--soft" : "wl__open"} onClick={() => setOpen(true)}>
          <Bell size={easy ? 26 : 18} aria-hidden="true" /> {day ? T.wlOpenDay : T.wlOpenAny}
        </button>
      ) : (
        <form onSubmit={submit} className={easy ? "easy__form" : "wl__form"}>
          <p className="wl__what">{T.wlIntro.split("{what}")[0]}<b>{what}</b>{T.wlIntro.split("{what}")[1] ?? ""}</p>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          <label className={easy ? "easy__field" : "field"}>
            <span>{T.wlName}</span>
            <input required autoComplete="name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className={easy ? "easy__field" : "field"}>
            <span>{T.wlPhone}</span>
            <input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="600 123 456" />
          </label>
          <label className={easy ? "easy__field" : "field"}>
            <span>{T.email} <em>{T.optional}</em></span>
            <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className={easy ? "easy__field" : "field"}>
            <span>{T.wlWhen}</span>
            <select value={form.part} onChange={(e) => setForm({ ...form, part: e.target.value })}>
              <option value="ANY">{T.wlAnyTime}</option>
              <option value="MORNING">{T.wlMorning}</option>
              <option value="AFTERNOON">{T.wlAfternoon}</option>
            </select>
          </label>
          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <button type="submit" className={easy ? "easy__btn easy__btn--main" : "btn btn--primary btn--block"} disabled={state === "busy"}>
            {state === "busy" ? T.wlBusy : T.wlSubmit}
          </button>
          <p className={easy ? "easy__legal" : "muted small"}>{T.wlLegal}</p>
        </form>
      )}
    </div>
  );
}
