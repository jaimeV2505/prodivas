import type { MetadataRoute } from "next";
import { query } from "@/lib/db";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();
  const fixed: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/reservar`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/servicios`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/privacidad`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/aviso-legal`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/cookies`, changeFrequency: "yearly", priority: 0.2 },
  ];
  try {
    const rows = await query<{ slug: string }>(`SELECT slug FROM services WHERE active ORDER BY sort, id`);
    return [...fixed, ...rows.map((r) => ({ url: `${base}/servicios/${r.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 }))];
  } catch {
    return fixed;
  }
}
