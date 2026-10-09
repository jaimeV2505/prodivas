import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Pro Diva Melide · Reserva tu cita", template: "%s · Pro Diva Melide" },
  description:
    "Centro de estética en Melide: manicura, pedicura, lifting de pestañas, depilación con hilo y láser, microblading. Reserva tu cita online.",
};

export const viewport: Viewport = {
  themeColor: "#FCE4EF",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
