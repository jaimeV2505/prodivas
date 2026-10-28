import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { hashIp } from "@/lib/bookings";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { buildSystemPrompt, hoursLines, parseAiReply, sanitizeMessages, type AiSalon } from "@/lib/divaAi";
import { clientIp } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const aiOn = () => !!process.env.ANTHROPIC_API_KEY;
const CANCEL_H = CONFIG.cancelNoticeHours;
const RESCHEDULE_H = Number(process.env.RESCHEDULE_NOTICE_HOURS ?? 12);
const REFUND_H = Number(process.env.DEPOSIT_REFUND_HOURS ?? 24);

type Cached = { at: number; salon: AiSalon; ids: Record<string, { id: number; waitMin: number; aftercare: string | null; depositCents: number }> };
let cache: Cached | null = null;

/** Datos reales del salón (5 min en memoria): de aquí salen el prompt de la IA y la información que usan las reglas. */
async function load(): Promise<Cached> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const [services, packs, hours] = await Promise.all([
    query<{ id: number; slug: string; name: string; category: string; duration_min: number; price_cents: number; deposit_cents: number; aftercare: string | null; wait_min: number }>(
      `SELECT s.id, s.slug, s.name, s.category, s.duration_min, s.price_cents, s.deposit_cents, s.aftercare,
              COALESCE((SELECT sum(minutes) FROM service_phases sp WHERE sp.service_id = s.id AND sp.kind = 'wait'), 0)::int AS wait_min
       FROM services s WHERE s.active ORDER BY s.sort, s.id`,
    ),
    query<{ slug: string; name: string; service_slugs: string[]; discount_percent: number }>(
      `SELECT slug, name, service_slugs, discount_percent FROM packages WHERE active ORDER BY featured DESC, sort, id LIMIT 12`,
    ).catch(() => []),
    query<{ weekday: number; closed: boolean; open: string | null; close: string | null; bs: string | null; be: string | null }>(
      `SELECT weekday, closed, to_char(open_time, 'HH24:MI') AS open, to_char(close_time, 'HH24:MI') AS close,
              to_char(break_start, 'HH24:MI') AS bs, to_char(break_end, 'HH24:MI') AS be FROM business_hours`,
    ).catch(() => []),
  ]);
  const salon: AiSalon = {
    name: CONFIG.salon.name,
    address: CONFIG.salon.address,
    phone: CONFIG.salon.phoneMobile,
    hours: hoursLines(hours),
    services: services.map((s) => ({ slug: s.slug, name: s.name, category: s.category, durationMin: s.duration_min, priceCents: s.price_cents, waitMin: s.wait_min || undefined, depositCents: s.deposit_cents || undefined })),
    packs: packs.map((p) => ({ slug: p.slug, name: p.name, serviceSlugs: p.service_slugs, discountPercent: p.discount_percent })),
    cancelHours: CANCEL_H,
    rescheduleHours: RESCHEDULE_H,
  };
  const ids = Object.fromEntries(services.map((s) => [s.slug, { id: s.id, waitMin: s.wait_min, aftercare: s.aftercare, depositCents: s.deposit_cents }]));
  cache = { at: Date.now(), salon, ids };
  return cache;
}

/** ¿Hay IA? Y los datos que solo sabe el servidor (horario, política, cuidados, pose, señal). Nunca revela la clave. */
export async function GET() {
  const base = { ai: aiOn() };
  try {
    const c = await load();
    return NextResponse.json(
      { ...base, hours: c.salon.hours, services: c.ids, policy: { cancelHours: CANCEL_H, refundHours: REFUND_H, rescheduleHours: RESCHEDULE_H } },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return NextResponse.json(base);
  }
}

/** Respuesta de la IA (opcional). Cualquier fallo devuelve {ok:false} y el chat sigue con las reglas. */
export async function POST(req: NextRequest) {
  const fail = NextResponse.json({ ok: false });
  if (!aiOn()) return fail;
  try {
    if (!(await allow(`diva:${hashIp(clientIp(req))}`, 20, 600))) return NextResponse.json({ ok: false, limited: true });
    const body = (await req.json().catch(() => null)) as { messages?: unknown; context?: { chosen?: unknown } } | null;
    const messages = sanitizeMessages(body?.messages);
    if (!messages.length) return fail;
    const c = await load();
    const valid = c.salon.services.map((s) => s.slug);
    const chosen = Array.isArray(body?.context?.chosen) ? (body!.context!.chosen as unknown[]).filter((x): x is string => typeof x === "string" && valid.includes(x)).slice(0, 4) : [];
    const system = buildSystemPrompt(c.salon) + (chosen.length ? `\n\nLa clienta ya tiene elegido: ${chosen.join(", ")}.` : "");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.DIVA_MODEL || "claude-haiku-5-5", max_tokens: 350, system, messages }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return fail;
    const j = (await r.json()) as { content?: { type: string; text?: string }[] };
    const raw = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    const { text, action } = parseAiReply(raw, valid);
    if (!text) return fail;
    return NextResponse.json({ ok: true, text, action });
  } catch {
    return fail;
  }
}
