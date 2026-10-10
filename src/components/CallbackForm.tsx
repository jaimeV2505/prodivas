"use client";

import { useState, type FormEvent } from "react";
import { Check, Phone } from "lucide-react";

/** "Que me llamen": para quien prefiere hablar con una persona. Avisa a la dueña al instante. */
export default function CallbackForm({ initialName = "", initialPhone = "", startOpen = false }: { initialName?: string; initialPhone?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [form, setForm] = useState({ name: initialName, phone: initialPhone, website: "" });
  const [state, setState] = useState<"idle" | "busy" | "ok">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      const r = await fetch("/api/callback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? "No hemos podido avisar. Llámanos directamente, por favor.");
        setState("idle");
        return;
      }
      setState("ok");
    } catch {
      setError("No hay conexión. Inténtalo otra vez.");
      setState("idle");
    }
  }

  if (state === "ok") {
    return (
      <div className="wl wl--ok wl--easy" role="status">
        <Check size={34} aria-hidden="true" />
        <p><b>¡Listo!</b> Te llamaremos lo antes posible.</p>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="easy__btn easy__btn--soft" onClick={() => setOpen(true)}>
        <Phone size={26} aria-hidden="true" /> Prefiero que me llamen
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="easy__form easy__card">
      <p className="easy__sub">Déjanos tu nombre y tu teléfono y te llamamos para darte cita.</p>
      {error && <p className="notice notice--error easy__notice" role="alert">{error}</p>}
      <label className="easy__field">
        <span>Tu nombre</span>
        <input required autoComplete="name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="easy__field">
        <span>Tu teléfono</span>
        <input required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="600 123 456" />
      </label>
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      <button type="submit" className="easy__btn easy__btn--main" disabled={state === "busy"}>{state === "busy" ? "Avisando…" : "Que me llamen"}</button>
    </form>
  );
}
