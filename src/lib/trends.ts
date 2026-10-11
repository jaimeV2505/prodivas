import { query } from "./db";

/** Tendencias que cuenta el avatar. Se editan en /admin/ajustes. */
export type Trend = {
  id: number;
  emoji: string;
  title: string;
  body: string;
  topic: string;
  serviceSlug: string | null;
};

export async function listTrends(): Promise<Trend[]> {
  try {
    return await query<Trend>(
      `SELECT id, emoji, title, body, topic, service_slug AS "serviceSlug"
       FROM trends WHERE active ORDER BY sort, id LIMIT 30`,
    );
  } catch {
    return []; // si la tabla aún no existe (migración pendiente), el avatar sigue funcionando sin tendencias
  }
}
