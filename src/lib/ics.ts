/** Enlace "data:" con un evento de calendario (.ics) para añadir la cita al móvil. */
export function icsHref(e: { code: string; title: string; startsAt: string; endsAt: string; location: string }): string {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pro Diva//Reservas//ES",
    "BEGIN:VEVENT",
    `UID:${e.code}@prodiva-melide`,
    `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(e.startsAt)}`,
    `DTEND:${f(e.endsAt)}`,
    `SUMMARY:${e.title}`,
    `LOCATION:${e.location.replace(/,/g, "\\,")}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Tu cita en Pro Diva",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n"));
}
