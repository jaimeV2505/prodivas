import type { Metadata } from "next";
import { Phone } from "lucide-react";
import { CONFIG } from "@/lib/config";

export const metadata: Metadata = {
  title: "Pedir cita",
  description: "Pide tu cita en Pro Diva (Melide) de forma sencilla.",
  appleWebApp: { capable: true, title: "Pro Diva", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const tel = `tel:+34${CONFIG.salon.phoneMobile.replace(/\s/g, "")}`;
  return (
    <div className="appshell">
      <header className="appshell__bar">
        <span className="wordmark" aria-label="Pro Diva">
          <span className="wordmark__pro">Pro</span>
          <span className="wordmark__diva">Diva</span>
        </span>
        <a className="appshell__call" href={tel}>
          <Phone size={22} aria-hidden="true" /> Llamar
        </a>
      </header>
      {children}
      <footer className="appshell__help">
        <p>¿Prefieres que te ayudemos? Llámanos al</p>
        <a href={tel}>{CONFIG.salon.phoneMobile}</a>
      </footer>
    </div>
  );
}
