const TZ = "Europe/Madrid";

export function fmtPrice(cents: number, locale = "es-ES"): string {
  const v = cents / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
  }).format(v);
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtLong(iso: string, locale = "es-ES"): string {
  const s = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDayLabel(day: string, locale = "es-ES"): string {
  const [y, m, d] = day.split("-").map(Number);
  const s = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtMonth(month: string, locale = "es-ES"): string {
  const [y, m] = month.split("-").map(Number);
  const s = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

/** Enlace wa.me a partir de un teléfono escrito a mano (asume España si no hay prefijo). */
export function waLink(phone: string, text?: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 9) digits = `34${digits}`;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Hora local del salón, "16:45". */
export function fmtHM(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(iso));
}

/** Día de la semana (0 = domingo) y minutos desde las 00:00, en la hora local del salón. Para «como siempre». */
export function localParts(iso: string): { day: string; dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "0";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  const hour = Number(g("hour")) % 24;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, dow, minutes: hour * 60 + Number(g("minute")) };
}

/** Nombre del día de la semana (0 = domingo) en el idioma elegido, en minúsculas. */
export function weekdayName(dow: number, locale = "es-ES"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + dow)));
}

/** "jue, 22 oct" en el idioma elegido (día en formato AAAA-MM-DD). */
export function fmtShortDay(day: string, locale = "es-ES"): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Iniciales de la semana empezando en lunes: L M X J V S D (o M T W T F S S). */
export function weekInitials(locale = "es-ES"): string[] {
  return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))).toUpperCase());
}
