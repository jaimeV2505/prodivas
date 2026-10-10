import { NextResponse, type NextRequest } from "next/server";
import { CONFIG } from "@/lib/config";
import { query } from "@/lib/db";
import { derivedSecret } from "@/lib/secrets";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Calendario para suscribirse desde el móvil de la dueña (Google, Apple, Outlook). La URL lleva un secreto. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (token.replace(/\.ics$/, "") !== derivedSecret("calendar-feed")) return new NextResponse("not found", { status: 404 });

  const rows = await query<{
    id: string;
    starts_at: Date;
    ends_at: Date;
    code: string | null;
    name: string | null;
    phone: string | null;
    notes: string | null;
    service: string;
    staff: string;
    response: string | null;
    deposit: string;
  }>(
    `SELECT b.id, b.starts_at, b.ends_at, b.code, b.customer_name AS name, b.customer_phone AS phone, b.notes,
            COALESCE((SELECT string_agg(bs.name, ' + ' ORDER BY bs.position) FROM booking_services bs WHERE bs.booking_id = b.id), s.name) AS service,
            st.name AS staff, b.customer_response AS response, b.deposit_status AS deposit
     FROM bookings b JOIN services s ON s.id = b.service_id JOIN staff st ON st.id = b.staff_id
     WHERE b.status = 'CONFIRMED' AND b.starts_at > now() - interval '14 days' AND b.starts_at < now() + interval '120 days'
     ORDER BY b.starts_at`,
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pro Diva//Citas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Citas Pro Diva",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  for (const r of rows) {
    const desc = [
      r.phone ? `Tel: ${r.phone}` : "",
      r.response === "CONFIRMED" ? "Confirmada por la clienta" : "",
      r.deposit === "PAID" ? "Señal pagada" : "",
      r.notes ? `Notas: ${r.notes}` : "",
      `${siteUrl()}/admin/cita/${r.id}`,
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@prodiva`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(new Date(r.starts_at))}`,
      `DTEND:${stamp(new Date(r.ends_at))}`,
      `SUMMARY:${esc(`${r.service} · ${r.name ?? ""}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      `LOCATION:${esc(CONFIG.salon.address)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new NextResponse(lines.join("\r\n"), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" },
  });
}
