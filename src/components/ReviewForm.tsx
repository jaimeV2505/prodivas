"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { fill } from "@/lib/i18n";
import type { MsgDict } from "@/lib/i18n/msg";

type Props = { code: string; token: string; t: MsgDict; googleUrl: string | null; alreadyRated: boolean };

/**
 * Valoración en dos pasos: las estrellas primero. A TODAS se les ofrece dejarla también en Google (Google desaconseja
 * filtrar solo las buenas); si son bajas (1–3) además se pide qué mejorar en privado, y la dueña recibe el aviso al momento.
 */
export default function ReviewForm({ code, token, t, googleUrl, alreadyRated }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "rated" | "sent">(alreadyRated ? "sent" : "idle");
  const [error, setError] = useState(false);

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/bookings/${code}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
    if (!r.ok) throw new Error("bad");
  };
  async function rate(n: number) {
    if (state === "busy") return;
    setRating(n);
    setError(false);
    setState("busy");
    try {
      await post({ rating: n });
      setState("rated");
    } catch {
      setError(true);
      setState("idle");
    }
  }
  async function send() {
    setState("busy");
    try {
      if (comment.trim()) await post({ comment: comment.trim() });
      setState("sent");
    } catch {
      setError(true);
      setState("rated");
    }
  }

  if (state === "sent") {
    return (
      <div className="rev" role="status">
        <p className="resp__big">{alreadyRated && rating === null ? t.revAlready : t.revThanks}</p>
      </div>
    );
  }

  return (
    <div className="rev">
      <div className="rev__stars" role="radiogroup" aria-label={t.revTitle}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={fill(t.revStars, { n })} className={`rev__star ${rating !== null && n <= rating ? "is-on" : ""}`} onClick={() => void rate(n)} disabled={state === "busy" || state === "rated"}>
            <Star size={40} aria-hidden="true" />
          </button>
        ))}
      </div>
      {error && <p className="notice notice--error" role="alert">{t.revError}</p>}
      {state === "rated" && rating !== null && rating >= 4 && (
        <div className="rev__after" role="status">
          <p className="resp__big">{t.revGoodTitle}</p>
          <p>{t.revGoodBody}</p>
          {googleUrl && (
            <a className="btn btn--primary btn--lg" href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={() => void post({ googleClicked: true }).catch(() => {})}>
              {t.revGoogle}
            </a>
          )}
        </div>
      )}
      {state === "rated" && rating !== null && rating <= 3 && (
        <div className="rev__after">
          <p className="resp__big">{t.revBadTitle}</p>
          <p>{t.revBadBody}</p>
          <label className="easy__field">
            <span>{t.revComment}</span>
            <textarea rows={4} maxLength={600} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button type="button" className="easy__btn easy__btn--main" onClick={() => void send()}>{t.revSend}</button>
          {googleUrl && (
            <p className="muted small">
              <a href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={() => void post({ googleClicked: true }).catch(() => {})}>{t.revGoogle}</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
