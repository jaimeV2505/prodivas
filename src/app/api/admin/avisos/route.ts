import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Para la campana del panel: cuántos avisos sin leer hay y cuál es el último. Solo con la sesión de la dueña. */
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const r = await query<{ n: number; id: number | null; title: string | null }>(
    `SELECT (SELECT count(*)::int FROM admin_notifications WHERE read_at IS NULL) AS n,
            (SELECT id FROM admin_notifications ORDER BY id DESC LIMIT 1) AS id,
            (SELECT title FROM admin_notifications ORDER BY id DESC LIMIT 1) AS title`,
  );
  return NextResponse.json({ unread: r[0]?.n ?? 0, lastId: r[0]?.id ?? 0, lastTitle: r[0]?.title ?? null }, { headers: { "Cache-Control": "no-store" } });
}
