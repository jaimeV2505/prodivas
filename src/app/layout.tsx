import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import Curtain from "@/components/Curtain";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Pro Diva Melide · Reserva tu cita", template: "%s · Pro Diva Melide" },
  description:
    "Centro de estética en Melide: manicura, pedicura, lifting de pestañas, depilación con hilo y láser, microblading. Reserva tu cita online.",
  openGraph: {
    type: "website",
    locale: "es_ES",
    siteName: "Pro Diva Melide",
    title: "Pro Diva Melide · Reserva tu cita",
    description: "Manicura, pedicura, pestañas, depilación y microblading en Melide. Mira los huecos libres y reserva con un toque.",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Mano con esmalte rosa sosteniendo una anémona magenta" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.jpg"] },
};

export const viewport: Viewport = {
  themeColor: "#FCE4EF",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // permite usar las zonas seguras (muesca y barra de inicio) en móviles y en la app instalada
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body>
        <Curtain />
        {children}
      </body>
    </html>
  );
}
