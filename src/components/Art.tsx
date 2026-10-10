import { Eye, Flower2, Hand, Sparkles } from "lucide-react";

export type ArtVariant = "hero" | "nails" | "eyes" | "wax" | "reel";

const ICON = { hero: Sparkles, nails: Hand, eyes: Eye, wax: Sparkles, reel: Flower2 } as const;

/** Fondo animado en CSS puro: se ve mientras no hay vídeo (o mientras carga). */
export default function Art({ variant }: { variant: ArtVariant }) {
  const Icon = ICON[variant];
  return (
    <div className={`art art--${variant}`} aria-hidden="true">
      <span className="art__blob art__blob--a" />
      <span className="art__blob art__blob--b" />
      <span className="art__blob art__blob--c" />
      <Icon className="art__icon" strokeWidth={1.1} />
    </div>
  );
}
