import type { CSSProperties } from "react";
import { HERO_PHOTO } from "@/lib/media";
import type { Polish } from "@/lib/polish";

/**
 * La foto del hero. Encima lleva tres capas con la máscara de las uñas: se mezclan con el color elegido
 * (modo "color" conserva brillos y sombras de la foto) y, según el esmalte, se oscurece o aclara un poco.
 * Las cuatro capas usan el mismo tamaño y posición, así que la máscara siempre coincide con la foto.
 */
export default function HeroPhoto({ color, variant }: { color: Polish | null; variant: "full" | "banner" }) {
  if (!HERO_PHOTO) return null;
  const hex = color?.hex ?? "transparent";
  const fx = color?.fx ?? {};
  return (
    <div
      className={`photo photo--${variant}`}
      role="img"
      aria-label="Mano con esmalte rosa sosteniendo una anémona magenta sobre seda rosa"
      style={{ ["--mask" as string]: `url(${HERO_PHOTO.mask})` } as CSSProperties}
    >
      <div className="photo__img" style={{ backgroundImage: `url(${HERO_PHOTO.src})` }} />
      <div className="photo__nails photo__nails--color" style={{ backgroundColor: hex, opacity: color ? 1 : 0 }} />
      <div className="photo__nails photo__nails--multiply" style={{ backgroundColor: hex, opacity: fx.multiply ?? 0 }} />
      <div className="photo__nails photo__nails--screen" style={{ backgroundColor: hex, opacity: fx.screen ?? 0 }} />
    </div>
  );
}
