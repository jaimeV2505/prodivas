"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CancelButton({ code, token }: { code: string; token: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setState("busy");
    setError(null);
    try {
      const r = await fetch(`/api/bookings/${code}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? "No se pudo cancelar.");
        setState("idle");
        return;
      }
      router.refresh();
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
      setState("idle");
    }
  }

  return (
    <div className="cancel">
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {state === "idle" && (
        <button type="button" className="btn btn--ghost" onClick={() => setState("confirm")}>Cancelar cita</button>
      )}
      {state !== "idle" && (
        <div className="cancel__confirm">
          <span>¿Seguro que quieres cancelarla?</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={cancel} disabled={state === "busy"}>
            {state === "busy" ? "Cancelando…" : "Sí, cancelar"}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setState("idle")} disabled={state === "busy"}>
            No, mantener
          </button>
        </div>
      )}
    </div>
  );
}
