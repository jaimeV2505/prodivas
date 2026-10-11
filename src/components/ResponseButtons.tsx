"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { CalendarCheck, Check, X } from "lucide-react";
import { fmtLong, fmtPrice } from "@/lib/format";

type View = "ask" | "rescue" | "reason" | "transfer" | "moved" | "cancelled" | "transferred" | "confirmed";
type Why = "sick" | "work" | "other";
type Alt = { startsAt: string; endsAt: string };

type Props = {
  code: string;
  token: string;
  initial: "pending" | "confirmed" | "cancelled";
  /** Quedan menos horas que el plazo de cancelación de sus servicios. */
  late: boolean;
  noticeHours: number;
  /** Señal (en céntimos) que se perdería si cancela ahora (0 si no pagó señal o aún está a tiempo). */
  depositLoss: number;
  /** Se puede cambiar la hora desde aquí. */
  canMove: boolean;
  /** El centro le ha pedido mover la cita (sin plazo ni penalización). */
  closedByCentre: boolean;
  /** Citas que quedan de su visita en horas distintas (1 = cita suelta). */
  legs: number;
};

const WHY: { id: Why; label: string }[] = [
  { id: "sick", label: "🤒 Enfermedad" },
  { id: "work", label: "💼 Trabajo o familia" },
  { id: "other", label: "✏️ Otro motivo" },
];

/**
 * Responder a la cita sin perderse: confirmar, y si no puede venir, primero «¿mejor la movemos?» con tres huecos
 * reales (un toque), después el motivo en un toque y, si cancela tarde, qué pasa con la señal; también puede
 * ceder la cita a otra persona o cancelar todas las de su visita. Botones enormes: claros para cualquier edad.
 */
export default function ResponseButtons({ code, token, initial, late, noticeHours, depositLoss, canMove, closedByCentre, legs }: Props) {
  const [view, setView] = useState<View>(initial === "confirmed" ? "confirmed" : initial === "cancelled" ? "cancelled" : closedByCentre && canMove ? "rescue" : "ask");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alts, setAlts] = useState<Alt[] | null>(null);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [why, setWhy] = useState<Why | null>(null);
  const [accept, setAccept] = useState(false);
  const [to, setTo] = useState({ name: "", phone: "" });
  const [who, setWho] = useState<string | null>(null);
  const [many, setMany] = useState(0);

  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? "No se pudo guardar. Llámanos, por favor.");
    return j;
  };
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  // Al entrar en «¿mejor la movemos?», se piden los 3 huecos
  useEffect(() => {
    if (view !== "rescue" || alts !== null) return;
    let off = false;
    fetch(`/api/bookings/${code}/alternatives?t=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((j: { alternatives: Alt[] }) => {
        if (off) return;
        setAlts(j.alternatives);
        if (!j.alternatives.length) setView(closedByCentre ? "rescue" : "reason"); // sin huecos: directo a cancelar
      })
      .catch(() => !off && setAlts([]));
    return () => {
      off = true;
    };
  }, [view, alts, code, token, closedByCentre]);

  const startNo = () => {
    setError(null);
    setView(canMove ? "rescue" : "reason");
  };
  const confirm = () => run("confirm", async () => {
    await post("/api/respond", { code, token, action: "confirm" });
    setView("confirmed");
  });
  const move = (a: Alt) => run(`move-${a.startsAt}`, async () => {
    await post(`/api/bookings/${code}/reschedule`, { token, startsAt: a.startsAt });
    setMovedTo(a.startsAt);
    setView("moved");
  });
  const cancel = () => run("cancel", async () => {
    await post("/api/respond", { code, token, action: "cancel", ...(why ? { why } : {}) });
    setView("cancelled");
  });
  const cancelAll = () => run("cancel-all", async () => {
    const j = await post(`/api/bookings/${code}/cancel-all`, { token, ...(why ? { why } : {}) });
    setMany(j.cancelled ?? legs);
    setView("cancelled");
  });
  const transfer = (e: FormEvent) => {
    e.preventDefault();
    void run("transfer", async () => {
      const j = await post(`/api/bookings/${code}/transfer`, { token, name: to.name, phone: to.phone });
      setWho(j.name ?? to.name);
      setView("transferred");
    });
  };

  if (view === "confirmed") {
    return (
      <div className="resp resp--ok" role="status">
        <Check size={44} aria-hidden="true" />
        <p className="resp__big">¡Perfecto! Te esperamos.</p>
        <button type="button" className="resp__link" onClick={startNo} disabled={busy !== null}>Me ha surgido algo, no puedo ir</button>
      </div>
    );
  }
  if (view === "moved") {
    return (
      <div className="resp resp--ok" role="status">
        <CalendarCheck size={44} aria-hidden="true" />
        <p className="resp__big">¡Hecho! Tu cita ahora es el {movedTo ? fmtLong(movedTo) : "día nuevo"}.</p>
        <p className="muted">Te hemos enviado el aviso. Recarga la página para verla actualizada.</p>
        <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>Ver mi cita</button>
      </div>
    );
  }
  if (view === "transferred") {
    return (
      <div className="resp resp--ok" role="status">
        <Check size={44} aria-hidden="true" />
        <p className="resp__big">Cita cedida a {who}.</p>
        <p className="muted">Le hemos mandado un mensaje con la cita y su enlace. Ya no tienes nada que hacer.</p>
        <Link className="btn btn--primary btn--lg" href="/cita">Pedir otra cita</Link>
      </div>
    );
  }
  if (view === "cancelled") {
    return (
      <div className="resp" role="status">
        <p className="resp__big">{many > 1 ? `Citas canceladas (${many}). Gracias por avisar.` : closedByCentre ? "Cita cancelada. Perdona las molestias." : "Cita cancelada. Gracias por avisar."}</p>
        {closedByCentre && <p className="muted">No te cobramos nada; si pagaste señal, te la devolvemos.</p>}
        <Link className="btn btn--primary btn--lg" href="/cita">Pedir otra cita</Link>
      </div>
    );
  }

  if (view === "rescue") {
    return (
      <div className="resp">
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <p className="resp__big">{closedByCentre ? "Elige una hora nueva" : "¿Mejor la movemos?"}</p>
        <p className="muted">{closedByCentre ? "Un toque y queda hecho. Sin coste." : "Estas horas están libres y son parecidas a la tuya. Un toque y queda cambiada."}</p>
        {alts === null && <p className="muted" aria-live="polite">Buscando huecos…</p>}
        <div className="resp__alts">
          {(alts ?? []).map((a) => (
            <button key={a.startsAt} type="button" className="resp__alt" onClick={() => void move(a)} disabled={busy !== null}>
              {busy === `move-${a.startsAt}` ? "Cambiando…" : fmtLong(a.startsAt)}
            </button>
          ))}
        </div>
        <Link className="easy__btn easy__btn--soft" href={`/c/${code}/cambiar?t=${token}`}>Elegir otro día u hora</Link>
        <button type="button" className="resp__link" onClick={() => setView("reason")} disabled={busy !== null}>
          {closedByCentre ? "Prefiero cancelar mi cita" : "No, prefiero cancelar"}
        </button>
      </div>
    );
  }

  if (view === "transfer") {
    return (
      <form className="resp resp__form" onSubmit={transfer}>
        <p className="resp__big">Ceder mi cita</p>
        <p className="muted">Pasa a otra persona: recibirá la confirmación y su propio enlace. Tú ya no tendrás que hacer nada.</p>
        {depositLoss > 0 && <p className="notice notice--info">La señal ({fmtPrice(depositLoss)}) se queda con la cita: se lo arregláis entre vosotras.</p>}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <label className="easy__field"><span>Su nombre</span><input required value={to.name} onChange={(e) => setTo({ ...to, name: e.target.value })} maxLength={80} autoComplete="off" /></label>
        <label className="easy__field"><span>Su teléfono</span><input required type="tel" inputMode="tel" value={to.phone} onChange={(e) => setTo({ ...to, phone: e.target.value })} placeholder="600 123 456" autoComplete="off" /></label>
        <button type="submit" className="easy__btn easy__btn--main" disabled={busy !== null}>{busy === "transfer" ? "Cediendo…" : "Ceder la cita"}</button>
        <button type="button" className="resp__link" onClick={() => setView("reason")} disabled={busy !== null}>Volver</button>
      </form>
    );
  }

  if (view === "reason") {
    const needsAccept = late && !closedByCentre && depositLoss > 0;
    return (
      <div className="resp">
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <p className="resp__big">¿Por qué no puedes venir?</p>
        <div className="resp__chips" role="group" aria-label="Motivo (opcional)">
          {WHY.map((w) => (
            <button key={w.id} type="button" className={`resp__chip ${why === w.id ? "is-on" : ""}`} aria-pressed={why === w.id} onClick={() => setWhy(why === w.id ? null : w.id)}>
              {w.label}
            </button>
          ))}
        </div>
        <p className="muted small">Es opcional: nos ayuda a organizarnos.</p>
        {late && !closedByCentre && (
          <div className="resp__warn" role="note">
            <strong>Quedan menos de {noticeHours} h.</strong>{" "}
            {depositLoss > 0 ? `Si cancelas ahora no se devuelve la señal (${fmtPrice(depositLoss)}).` : "Si cancelas ahora avisamos al salón y el hueco queda libre para otra persona."}
            {" "}Si prefieres, <button type="button" className="resp__inline" onClick={() => setView("transfer")}>cede tu cita a otra persona.</button>
          </div>
        )}
        {closedByCentre && <p className="notice notice--info">No te cobramos nada; si pagaste señal, te la devolvemos.</p>}
        {needsAccept && (
          <label className="check resp__accept">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span>Entiendo que no se devuelve la señal</span>
          </label>
        )}
        <button type="button" className="resp__btn resp__btn--no" onClick={() => void cancel()} disabled={busy !== null || (needsAccept && !accept)}>
          <X size={30} aria-hidden="true" /> {busy === "cancel" ? "Cancelando…" : "Cancelar mi cita"}
        </button>
        {legs > 1 && (
          <button type="button" className="resp__btn resp__btn--no resp__btn--soft" onClick={() => void cancelAll()} disabled={busy !== null || (needsAccept && !accept)}>
            {busy === "cancel-all" ? "Cancelando…" : `Cancelar las ${legs} citas de esta visita`}
          </button>
        )}
        <button type="button" className="resp__link" onClick={() => setView(canMove ? "rescue" : "ask")} disabled={busy !== null}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="resp">
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <button type="button" className="resp__btn resp__btn--yes" onClick={() => void confirm()} disabled={busy !== null}>
        <Check size={30} aria-hidden="true" /> {busy === "confirm" ? "Guardando…" : "Sí, voy a ir"}
      </button>
      <button type="button" className="resp__btn resp__btn--no" onClick={startNo} disabled={busy !== null}>
        <X size={30} aria-hidden="true" /> No puedo ir
      </button>
      <p className="muted">Si no puedes, primero te proponemos otra hora. Y si cancelas, otra persona podrá aprovechar el hueco. ¡Gracias por avisar!</p>
    </div>
  );
}
