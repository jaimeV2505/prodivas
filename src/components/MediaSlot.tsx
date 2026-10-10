"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { STILLS } from "@/lib/media";
import Art, { type ArtVariant } from "./Art";

type Props = { name: string; variant: ArtVariant; className?: string };

/**
 * Ranura de vídeo: busca /videos/<name>.mp4. Si existe, se reproduce en bucle (mudo) solo mientras
 * está en pantalla. Si no, se queda el fondo animado. Para cambiar un vídeo basta con sustituir el archivo.
 */
export default function MediaSlot({ name, variant, className = "" }: Props) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const [exists, setExists] = useState(false);
  const [ready, setReady] = useState(false);
  const src = `/videos/${name}.mp4`;
  const still = STILLS[name];

  useEffect(() => {
    let off = false;
    fetch(src, { method: "HEAD" })
      .then((r) => !off && setExists(r.ok && (r.headers.get("content-type") ?? "").includes("video")))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [src]);

  useEffect(() => {
    const v = ref.current;
    if (!exists || !v) return;
    if (reduce) {
      v.pause();
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.2 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [exists, reduce]);

  return (
    <div className={`media ${className}`}>
      <Art variant={variant} />
      {still && <img className="media__img" src={still} alt="" loading="lazy" decoding="async" />}
      {exists && (
        <video
          ref={ref}
          className={`media__video ${ready ? "is-ready" : ""}`}
          src={src}
          poster={`/videos/${name}.jpg`}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          onCanPlay={() => setReady(true)}
        />
      )}
    </div>
  );
}
