"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, X } from "lucide-react";

type Props = { code: string; token: string; initial: "pending" | "confirmed" | "cancelled" };

/** Dos botones enormes: lo bastante claros para cualquier edad. */
export default function ResponseButtons({ code, token, initial }: Props) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "confirm" | "cancel") {
    setBusy(action);
    setError(null);
    try {
      const r = await fetch("/api/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, token, action }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? "No se pudo guardar. Llámanos, por favor.");
        return;
      }
      setState(j.state === "confirmed" ? "confirmed" : "cancelled");
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  if (state === "confirmed") {
    return (
      <div className="resp resp--ok" role="status">
        <Check size={44} aria-hidden="true" />
        <p className="resp__big">¡Perfecto! Te esperamos.</p>
        <button type="button" className="resp__link" onClick={() => send("cancel")} disabled={busy !== null}>
          Me ha surgido algo, no puedo ir
        </button>
      </div>
    );
  }
  if (state === "cancelled") {
    return (
      <div className="resp" role="status">
        <p className="resp__big">Cita cancelada. Gracias por avisar.</p>
        <Link className="btn btn--primary btn--lg" href="/cita">Pedir otra cita</Link>
      </div>
    );
  }
  return (
    <div className="resp">
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <button type="button" className="resp__btn resp__btn--yes" onClick={() => send("confirm")} disabled={busy !== null}>
        <Check size={30} aria-hidden="true" /> {busy === "confirm" ? "Guardando…" : "Sí, voy a ir"}
      </button>
      <button type="button" className="resp__btn resp__btn--no" onClick={() => send("cancel")} disabled={busy !== null}>
        <X size={30} aria-hidden="true" /> {busy === "cancel" ? "Cancelando…" : "No puedo ir"}
      </button>
      <p className="muted">Si cancelas, otra persona podrá aprovechar ese hueco. ¡Gracias por avisar!</p>
    </div>
  );
}
