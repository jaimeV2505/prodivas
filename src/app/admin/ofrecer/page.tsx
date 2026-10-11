import type { Metadata } from "next";
import Link from "next/link";
import AdminNav from "@/components/AdminNav";
import { getSlotRows } from "@/lib/availability";
import { isAdmin } from "@/lib/auth";
import { CONFIG } from "@/lib/config";
import { addDays, isDay, todayIn } from "@/lib/dates";
import { query } from "@/lib/db";
import { fmtDayLabel } from "@/lib/format";
import { offerDayAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ofrecer huecos", robots: { index: false, follow: false } };

const PART: Record<string, string> = { ANY: "cualquier hora", MORNING: "por la mañana", AFTERNOON: "por la tarde" };

export default async function OfferPage({ searchParams }: { searchParams: Promise<{ d?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel"><Link className="btn btn--primary" href="/admin">Entrar en la agenda</Link></section>
      </main>
    );
  }
  const today = todayIn(CONFIG.tz);
  const day = sp.d && isDay(sp.d) && sp.d >= today ? sp.d : addDays(today, 1);
  const shortest = (await query<{ name: string; duration_min: number; buffer_min: number; slot_step_min: number | null }>(`SELECT name, duration_min, buffer_min, slot_step_min FROM services WHERE active ORDER BY duration_min LIMIT 1`))[0];
  const free = shortest
    ? (await getSlotRows({ from: day, to: day, durationMin: shortest.duration_min, bufferMin: shortest.buffer_min, stepMin: shortest.slot_step_min ?? shortest.duration_min })).filter((r) => r.available && new Date(r.startsAt).getTime() > Date.now())
    : [];
  const waiting = await query<{ name: string; service: string; part: string; day: string | null }>(
    `SELECT w.name, s.name AS service, w.part, to_char(w.day, 'YYYY-MM-DD') AS day
     FROM waitlist w JOIN services s ON s.id = w.service_id
     WHERE w.status = 'ACTIVE' AND (w.day = $1::date OR w.day IS NULL) ORDER BY w.created_at LIMIT 30`,
    [day],
  );
  return (
    <main className="container admin">
      <AdminNav active="dia" />
      <h1 className="admin__h1">Ofrecer huecos · {fmtDayLabel(day)}</h1>
      {sp.ok && <p className="notice notice--info" role="status">{sp.ok}</p>}
      {sp.err && <p className="notice notice--error" role="alert">{sp.err}</p>}
      <section className="panel">
        <h2 className="panel__title panel__title--sm">Huecos libres ({free.length})</h2>
        {free.length ? <p className="offer__slots">{free.map((r) => r.time).join(" · ")}</p> : <p className="muted">No quedan huecos libres ese día.</p>}
        <h2 className="panel__title panel__title--sm">En lista de espera ({waiting.length})</h2>
        {waiting.length ? (
          <ul className="timeoff">
            {waiting.map((w, i) => (
              <li key={i}><span>{w.name} · {w.service} · {PART[w.part] ?? w.part}{w.day ? "" : " · cualquier día"}</span></li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nadie espera hueco para ese día.</p>
        )}
        <form action={offerDayAction} className="form">
          <input type="hidden" name="day" value={day} />
          <button className="btn btn--primary btn--lg" type="submit" disabled={!free.length || !waiting.length}>Avisar a la lista de espera ahora</button>
          <p className="muted small">Se avisa por orden de llegada, solo a quienes les cabe su servicio, y quien reserve primero se queda el hueco.</p>
        </form>
      </section>
    </main>
  );
}
