import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pro Diva · Pedir cita",
    short_name: "Pro Diva",
    description: "Pide tu cita en Pro Diva (Melide) en pocos pasos.",
    lang: "es",
    start_url: "/cita",
    scope: "/",
    display: "standalone",
    background_color: "#FCE4EF",
    theme_color: "#B0206A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
