/**
 * Paleta de esmaltes de la mano interactiva del hero.
 * ⚠️ EJEMPLO: sustituye por los esmaltes reales del centro (nombre y color aproximado).
 * El nombre elegido se añade a la cita como "Color: …".
 */
export type Polish = {
  slug: string;
  name: string;
  hex: string;
  /** Retoque al pintar las uñas de la foto: oscurecer (multiply) o aclarar (screen) además del color. */
  fx?: { multiply?: number; screen?: number };
};

export const POLISH: Polish[] = [
  { slug: "rosa-chicle", name: "Rosa chicle", hex: "#F27AB9" },
  { slug: "magenta", name: "Magenta", hex: "#B0206A", fx: { multiply: 0.28 } },
  { slug: "nude", name: "Nude", hex: "#E8B9A4", fx: { screen: 0.12 } },
  { slug: "rojo-clasico", name: "Rojo clásico", hex: "#C1121F", fx: { multiply: 0.4 } },
  { slug: "burdeos", name: "Burdeos", hex: "#6D1030", fx: { multiply: 0.6 } },
  { slug: "blanco-roto", name: "Blanco roto", hex: "#F4EDE4", fx: { screen: 0.55 } },
  { slug: "lila", name: "Lila", hex: "#B79CE0", fx: { screen: 0.12 } },
  { slug: "coral", name: "Coral", hex: "#FF7F6B" },
];
