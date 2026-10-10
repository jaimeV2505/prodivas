import type { Metadata } from "next";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import { getSlotMode, SLOT_MODES, type SlotMode } from "@/lib/availability";
import { query } from "@/lib/db";
import { WEEKDAYS } from "@/lib/format";
import { addServiceAction, saveHoursAction, saveModeAction, saveServiceAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ajustes", robots: { index: false, follow: false } };

type Svc = { id: number; name: string; category: string; duration_min: number; price_cents: number; slot_step_min: number | null; active: boolean; sort: number };
type Hours = { weekday: number; closed: boolean; open: string | null; close: string | null; bs: string | null; be: string | null };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="container narrow admin">
        <section className="panel">
          <p>Necesitas entrar en la agenda primero.</p>
          <Link className="btn btn--primary" href="/admin">Ir a la agenda</Link>
        </section>
      </main>
    );
  }

  const [services, hoursRows, mode] = await Promise.all([
    query<Svc>(`SELECT id, name, category, duration_min, price_cents, slot_step_min, active, sort FROM services ORDER BY active DESC, sort, id`),
    query<Hours>(
      `SELECT weekday, closed, to_char(open_time, 'HH24:MI') AS open, to_char(close_time, 'HH24:MI') AS close,
              to_char(break_start, 'HH24:MI') AS bs, to_char(break_end, 'HH24:MI') AS be FROM business_hours`,
    ),
    getSlotMode(),
  ]);
  const byDay = new Map(hoursRows.map((h) => [h.weekday, h]));
  const eur = (c: number) => (c / 100).toString().replace(".", ",");

  return (
    <main className="container admin">
      <header className="admin__bar">
        <h1>Ajustes</h1>
        <Link className="btn btn--ghost btn--sm" href="/admin">← Volver a la agenda</Link>
      </header>
      {sp.ok && <p className="notice notice--info" role="status">{sp.ok}</p>}
      {sp.err && <p className="notice notice--error" role="alert">{sp.err}</p>}
      <p className="muted">
        Los cambios afectan a los huecos que se ofrecen a partir de ahora. Las citas ya reservadas conservan su hora y su duración.
      </p>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Cómo se ofrecen los huecos</h2>
        <form action={saveModeAction} className="modes">
          {(Object.keys(SLOT_MODES) as SlotMode[]).map((m) => (
            <label key={m} className={`mode ${mode === m ? "is-on" : ""}`}>
              <input type="radio" name="mode" value={m} defaultChecked={mode === m} />
              <span><b>{SLOT_MODES[m].label}</b><small>{SLOT_MODES[m].help}</small></span>
            </label>
          ))}
          <button className="btn btn--primary" type="submit">Guardar modo</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Servicios</h2>
        <p className="muted small">
          El hueco de cada servicio es su duración (30 min de servicio = huecos de 30 min). Rellena "Hueco" solo si quieres otro ritmo. Para quitar un servicio, desmarca "Activo": no se borra.
        </p>
        <div className="svc-list">
          {services.map((s) => (
            <form key={s.id} action={saveServiceAction} className={`svc ${s.active ? "" : "svc--off"}`}>
              <input type="hidden" name="id" value={s.id} />
              <label className="field"><span>Servicio</span><input name="name" defaultValue={s.name} required maxLength={80} /></label>
              <label className="field"><span>Categoría</span><input name="category" defaultValue={s.category} required maxLength={60} /></label>
              <label className="field"><span>Duración (min)</span><input name="duration" type="number" min={5} max={480} step={5} defaultValue={s.duration_min} required /></label>
              <label className="field"><span>Precio (€)</span><input name="price" inputMode="decimal" defaultValue={eur(s.price_cents)} required /></label>
              <label className="field"><span>Hueco (min)</span><input name="step" type="number" min={5} max={480} step={5} defaultValue={s.slot_step_min ?? ""} placeholder={String(s.duration_min)} /></label>
              <label className="field"><span>Orden</span><input name="sort" type="number" min={0} defaultValue={s.sort} /></label>
              <label className="check svc__active"><input type="checkbox" name="active" defaultChecked={s.active} /><span>Activo</span></label>
              <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
            </form>
          ))}
        </div>
        <h3 className="svc__new">Añadir servicio</h3>
        <form action={addServiceAction} className="svc">
          <label className="field"><span>Servicio</span><input name="name" required maxLength={80} /></label>
          <label className="field"><span>Categoría</span><input name="category" required maxLength={60} list="cats" /></label>
          <datalist id="cats">{Array.from(new Set(services.map((s) => s.category))).map((c) => <option key={c} value={c} />)}</datalist>
          <label className="field"><span>Duración (min)</span><input name="duration" type="number" min={5} max={480} step={5} defaultValue={30} required /></label>
          <label className="field"><span>Precio (€)</span><input name="price" inputMode="decimal" defaultValue="0" required /></label>
          <label className="field"><span>Hueco (min)</span><input name="step" type="number" min={5} max={480} step={5} placeholder="= duración" /></label>
          <label className="field"><span>Orden</span><input name="sort" type="number" min={0} defaultValue={500} /></label>
          <button className="btn btn--primary btn--sm" type="submit">Añadir</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel__title panel__title--sm">Horario</h2>
        <p className="muted small">Pausa opcional (p. ej. 14:00 a 16:00): los huecos se calculan por separado antes y después de la pausa.</p>
        <div className="svc-list">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const h = byDay.get(d);
            return (
              <form key={d} action={saveHoursAction} className="svc svc--hours">
                <input type="hidden" name="weekday" value={d} />
                <strong className="svc__day">{WEEKDAYS[d]}</strong>
                <label className="check"><input type="checkbox" name="closed" defaultChecked={!h || h.closed} /><span>Cerrado</span></label>
                <label className="field"><span>Abre</span><input type="time" name="open" defaultValue={h?.open ?? "10:00"} /></label>
                <label className="field"><span>Cierra</span><input type="time" name="close" defaultValue={h?.close ?? "20:00"} /></label>
                <label className="field"><span>Pausa desde</span><input type="time" name="bs" defaultValue={h?.bs ?? ""} /></label>
                <label className="field"><span>Pausa hasta</span><input type="time" name="be" defaultValue={h?.be ?? ""} /></label>
                <button className="btn btn--ghost btn--sm" type="submit">Guardar</button>
              </form>
            );
          })}
        </div>
      </section>
    </main>
  );
}
