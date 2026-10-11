/** Traducciones de los servicios de ejemplo (por slug). Los servicios que añadas tú se muestran en castellano hasta que los traduzcas aquí. */
type T = { name: string; description?: string };
export const SERVICE_I18N: Record<string, { gl: T; en: T }> = {
  "manicura-semipermanente": { gl: { name: "Manicura semipermanente", description: "Limado, cutículas e esmaltado semipermanente." }, en: { name: "Gel manicure", description: "Shaping, cuticles and gel polish." } },
  "manicura-clasica": { gl: { name: "Manicura clásica", description: "Limado, cutículas e esmalte tradicional." }, en: { name: "Classic manicure", description: "Shaping, cuticles and regular polish." } },
  "pedicura": { gl: { name: "Pedicura", description: "Tratamento completo dos pés." }, en: { name: "Pedicure", description: "Complete foot treatment." } },
  "pedicura-semipermanente": { gl: { name: "Pedicura semipermanente", description: "Pedicura con esmaltado semipermanente." }, en: { name: "Gel pedicure", description: "Pedicure with gel polish." } },
  "lifting-pestanas": { gl: { name: "Lifting de pestanas", description: "Curvatura e definición natural das túas pestanas." }, en: { name: "Lash lift", description: "Natural curl and definition for your lashes." } },
  "tinte-cejas": { gl: { name: "Tinte de cellas" }, en: { name: "Brow tint" } },
  "microblading": { gl: { name: "Microblading de cellas", description: "Inclúe deseño personalizado." }, en: { name: "Eyebrow microblading", description: "Includes a custom design." } },
  "hilo-cejas": { gl: { name: "Cellas con fío" }, en: { name: "Threaded brows" } },
  "hilo-cara": { gl: { name: "Cara completa con fío" }, en: { name: "Full face threading" } },
  "laser-pequena": { gl: { name: "Láser · zona pequena", description: "Bozo, axilas, ingles..." }, en: { name: "Laser · small area", description: "Upper lip, underarms, bikini line..." } },
  "laser-mediana": { gl: { name: "Láser · zona mediana", description: "Medias pernas, brazos..." }, en: { name: "Laser · medium area", description: "Half legs, arms..." } },
  "laser-piernas": { gl: { name: "Láser · pernas completas" }, en: { name: "Laser · full legs" } },
};
export const CATEGORY_I18N: Record<string, { gl: string; en: string }> = {
  "Manicura y pedicura": { gl: "Manicura e pedicura", en: "Manicure and pedicure" },
  "Mirada": { gl: "Mirada", en: "Eyes" },
  "Depilación": { gl: "Depilación", en: "Hair removal" },
};
