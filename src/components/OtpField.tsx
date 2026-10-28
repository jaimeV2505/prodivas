"use client";

import { useEffect, useRef } from "react";
import { ShieldCheck } from "lucide-react";

/** Casilla del código de 6 cifras que llega por mensaje. En local el código se muestra para poder probar. */
export default function OtpField({ value, onChange, devCode, phone }: { value: string; onChange: (v: string) => void; devCode?: string; phone: string }) {
  const box = useRef<HTMLDivElement>(null);
  // Al aparecer, se lleva a la clienta hasta la casilla y se le deja escribir directamente
  useEffect(() => {
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    box.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="otp" role="group" aria-label="Verificación del teléfono" ref={box}>
      <label className="field">
        <span>
          <ShieldCheck size={16} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6 }} />
          Código que te hemos enviado al {phone}
        </span>
        <input
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          aria-describedby="otp-help"
        />
      </label>
      <p id="otp-help" className="muted small">
        Es solo para comprobar que el número es tuyo; te lo pedimos una vez y no volverás a verlo.
        {devCode ? <> <b>Modo local: tu código es {devCode}</b></> : null}
      </p>
    </div>
  );
}
