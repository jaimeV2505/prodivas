import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import AutoRefresh from "@/components/AutoRefresh";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { markNoticesReadAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avisos", robots: { index: false, follow: false } };

const ICON: Record<string, string> = { owner_new: "🆕", owner_confirmed: "✅", owner_cancelled: "❌", digest: "📥", owner_callback: "📞", owner_review: "⭐", owner_raw: "⚠️", owner_unconfirmed: "🔔" };

/** Bandeja de avisos: todo lo que le llega a la dueña (nuevas reservas, cancelaciones, respuestas, resumen diario). */
export default async function Avisos() {
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  const rows = await query<{ id: number; kind: string; title: string; body: string | null; booking_id: string | null; at: string; unread: boolean }>(
    `SELECT id, kind, title, body, booking_id, to_char(at AT TIME ZONE $1::text, 'DD/MM HH24:MI') AS at, (read_at IS NULL) AS unread
     FROM admin_notifications ORDER BY id DESC LIMIT 100`,
    [CONFIG.tz],
  );
  const unread = rows.filter((r) => r.unread).length;
  return (
    <main className="container admin">
      <AutoRefresh />
      <AdminNav active="avisos" />
      <section className="panel">
        <h1 className="panel__title">Avisos</h1>
        <p className="muted">
          Aquí queda todo lo que te avisamos: reservas nuevas, cancelaciones, respuestas de las clientas y el resumen diario. Además te llega por
          Telegram, email o SMS al {CONFIG.salon.phoneMobile} si lo tienes configurado (Ajustes → Estado de la configuración).
        </p>
        {unread > 0 && (
          <form action={markNoticesReadAction}>
            <button className="btn btn--ghost btn--sm" type="submit">Marcar los {unread} como leídos</button>
          </form>
        )}
        {rows.length === 0 ? (
          <p className="muted">Todavía no hay avisos. Cuando entre una reserva aparecerá aquí.</p>
        ) : (
          <ul className="timeoff">
            {rows.map((r) => (
              <li key={r.id} style={r.unread ? { background: "rgba(176, 32, 106, 0.08)", borderRadius: 12 } : undefined}>
                <span>
                  <b>{ICON[r.kind] ?? "🔔"} {r.title}</b> · {r.at}
                  {r.body && r.body !== r.title && <><br /><span className="muted" style={{ whiteSpace: "pre-line" }}>{r.body}</span></>}
                  {r.booking_id && <><br /><Link href={`/admin/cita/${r.booking_id}`}>Ver la cita</Link></>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
