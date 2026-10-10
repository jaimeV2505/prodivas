import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sha = (v: string) => createHash("sha256").update(v).digest();

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !timingSafeEqual(sha(given), sha(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runReminders();
    await query(
      `INSERT INTO settings (key, value) VALUES ('last_cron_run', now()::text)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron:reminders]", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
