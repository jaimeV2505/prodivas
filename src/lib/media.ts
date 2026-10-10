/**
 * Imágenes de la web (carpeta public/images).
 *
 * HERO_PHOTO: foto de la portada + máscara de las uñas (para que el selector de esmaltes cambie el color
 * de las uñas reales de la foto). Si cambias la foto, regenera la máscara:  python3 scripts/make-nail-mask.py
 * La foto está DESACTIVADA por defecto (hasta tener una de más calidad). Para probarla: NEXT_PUBLIC_HERO_PHOTO=on
 *
 * STILLS: fotos de los paneles de servicios (clave = nombre de la ranura). Añade aquí "eyes", "wax"… cuando
 * tengas sus imágenes en public/images/<nombre>.jpg (si hay vídeo en public/videos, el vídeo va encima).
 */
export const HERO_PHOTO =
  process.env.NEXT_PUBLIC_HERO_PHOTO === "on"
    ? ({ src: "/images/hero.jpg", mask: "/images/hero-nails-mask.png" } as const)
    : null;

/** Por ahora vacío: los paneles usan los dibujos animados. Añade aquí las fotos buenas cuando las tengas. */
export const STILLS: Record<string, string> = {
  // nails: "/images/nails.jpg",
};
