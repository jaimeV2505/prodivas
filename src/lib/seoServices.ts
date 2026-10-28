import { CONFIG } from "./config";
import { query } from "./db";

export type SeoService = {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  durationMin: number;
  priceCents: number;
  depositCents: number;
  cancelHours: number | null;
  rebookWeeks: number | null;
  aftercare: string | null;
};

const COLS = `id, slug, name, category, description, duration_min AS "durationMin", price_cents AS "priceCents",
  deposit_cents AS "depositCents", cancel_notice_hours AS "cancelHours", rebook_weeks AS "rebookWeeks", aftercare`;

export const listSeoServices = () => query<SeoService>(`SELECT ${COLS} FROM services WHERE active ORDER BY sort, id`);

export async function getSeoService(slug: string): Promise<{ service: SeoService; related: SeoService[] } | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const all = await listSeoServices();
  const service = all.find((s) => s.slug === slug);
  if (!service) return null;
  return { service, related: all.filter((s) => s.category === service.category && s.id !== service.id).slice(0, 4) };
}

export const durationText = (min: number) => (min < 60 ? `${min} minutos` : min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60} min`);

export const reserveHref = (slug: string) => `/reservar?servicio=${slug}&utm_source=seo`;

export const aboutService = (s: SeoService) =>
  s.description?.trim() ? s.description.trim() : `${s.name} en ${CONFIG.salon.city}: ${s.category.toLowerCase()} en ${CONFIG.salon.name}, con cita online.`;
