import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import AutoRefresh from "@/components/AutoRefresh";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { devMode } from "@/lib/messaging";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mensajes simulados", robots: { index: false, follow: false } };

const KIND: Record<string, string> = {
  otp: "Código de verificación",
  created: "Confirmación de cita",
  group_created: "Confirmación de varias citas",
  reminder: "Recordatorio",
  abandoned: "Reserva sin terminar",
  reactivation: "Te echamos de menos",
  aftercare: "Gracias + cuidados + valoración",
  rebook_nudge: "Toca retoque",
  waitlist: "Hueco libre (lista de espera)",
};

/** Solo en local (o con DEMO_MODE=on): los mensajes que saldrían por SMS/WhatsApp/email si hubiera canales configurados. */
export default async function Bandeja() {
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  const rows = devMode()
    ? await query<{ id: number; kind: string; detail: string | null; at: string }>(
        `SELECT id, kind, detail, to_char(created_at AT TIME ZONE $1::text, 'DD/MM HH24:MI:SS') AS at FROM notification_log WHERE channel = 'dev' ORDER BY id DESC LIMIT 80`,
        [CONFIG.tz],
      )
    : [];
  return (
    <main className="container admin">
      <AutoRefresh />
      <AdminNav active="bandeja" />
      <section className="panel">
        <h1 className="panel__title">Mensajes simulados</h1>
        <p className="muted">
          {devMode()
            ? "Aquí aparece todo lo que la web enviaría a tus clientas (SMS, WhatsApp, email) mientras no haya canales reales configurados. Sirve para probar el embudo en local."
            : "Hay canales reales configurados: los mensajes salen de verdad y esta bandeja no se usa."}
        </p>
        {rows.length === 0 ? (
          <p className="muted">Todavía no hay mensajes. Haz una reserva de prueba en /reservar.</p>
        ) : (
          <ul className="timeoff">
            {rows.map((r) => (
              <li key={r.id}>
                <span><b>{KIND[r.kind] ?? r.kind}</b> · {r.at}<br />{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
