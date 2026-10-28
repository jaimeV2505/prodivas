import { query } from "./db";

/** Bandeja de avisos del panel: todo lo que se le avisa a la dueña por Telegram, email o SMS queda también aquí. */
export async function pushInbox(kind: string, title: string, body: string | null, bookingId: string | null = null): Promise<void> {
  try {
    await query(`INSERT INTO admin_notifications (kind, title, body, booking_id) VALUES ($1, $2, $3, $4::uuid)`, [kind, title.slice(0, 200), body ? body.slice(0, 1500) : null, bookingId]);
  } catch (e) {
    console.error("[inbox]", e);
  }
}

export async function unreadCount(): Promise<number> {
  try {
    const r = await query<{ n: number }>(`SELECT count(*)::int AS n FROM admin_notifications WHERE read_at IS NULL`);
    return r[0]?.n ?? 0;
  } catch {
    return 0;
  }
}
