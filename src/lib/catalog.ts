import { query } from "./db";
import { getDepositPolicy } from "./deposit";
import type { Addon, Pack, Service } from "@/components/BookingFlow";

export type Catalog = { services: Service[]; addons: Addon[]; packs: Pack[]; depositPolicy: "service" | "repeat" };

/**
 * Todo lo que necesita la pantalla de reservar. Si la base de datos aún no tiene las columnas nuevas
 * (migración pendiente), cae a la consulta antigua para que la web no se rompa mientras tanto.
 */
export async function loadCatalog(): Promise<Catalog> {
  try {
    const [services, addons, packs, policy] = await Promise.all([
      query<Service>(
        `SELECT id, slug, name, category, description, duration_min AS "durationMin", price_cents AS "priceCents",
                deposit_cents AS "depositCents", deposit_always AS "depositAlways", rebook_weeks AS "rebookWeeks", consent_kind AS "consentKind"
         FROM services WHERE active ORDER BY sort, id`,
      ),
      query<Addon>(
        `SELECT id, slug, name, description, duration_min AS "durationMin", price_cents AS "priceCents", category, i18n
         FROM addons WHERE active ORDER BY sort, id`,
      ),
      query<Pack>(
        `SELECT id, slug, name, emoji, description, service_slugs AS "serviceSlugs", discount_percent AS "discountPercent", i18n
         FROM packages WHERE active ORDER BY sort, id`,
      ),
      getDepositPolicy(),
    ]);
    return { services, addons, packs, depositPolicy: policy.mode };
  } catch (e) {
    console.error("[catalog] ¿migración pendiente? Se usa el catálogo básico:", e instanceof Error ? e.message : e);
    const services = await query<Service>(
      `SELECT id, slug, name, category, description, duration_min AS "durationMin", price_cents AS "priceCents", deposit_cents AS "depositCents"
       FROM services WHERE active ORDER BY sort, id`,
    );
    return { services, addons: [], packs: [], depositPolicy: "service" };
  }
}
