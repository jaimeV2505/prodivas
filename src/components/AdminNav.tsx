import Link from "next/link";
import { logout } from "@/app/admin/actions";
import { devMode } from "@/lib/messaging";

const TABS = [
  { href: "/admin", key: "dia", label: "Hoy" },
  { href: "/admin/panel", key: "panel", label: "Panel" },
  { href: "/admin/semana", key: "semana", label: "Semana" },
  { href: "/admin/clientas", key: "clientas", label: "Clientas" },
  { href: "/admin/valoraciones", key: "valoraciones", label: "Opiniones" },
  { href: "/admin/ajustes", key: "ajustes", label: "Ajustes" },
];
const DEMO_TAB = { href: "/admin/bandeja", key: "bandeja", label: "Mensajes" };

export default function AdminNav({ active }: { active: "dia" | "panel" | "bandeja" | "semana" | "clientas" | "valoraciones" | "ajustes" | "cita" }) {
  return (
    <header className="admin__bar admin__bar--nav">
      <nav className="admin__tabs" aria-label="Panel">
        {(devMode() ? [...TABS.slice(0, -1), DEMO_TAB, TABS[TABS.length - 1]] : TABS).map((t) => (
          <Link key={t.key} href={t.href} className={`admin__tab ${active === t.key ? "is-on" : ""}`} aria-current={active === t.key ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <form action={logout} className="admin__logout">
        <button className="btn btn--ghost btn--sm" type="submit">Salir</button>
      </form>
    </header>
  );
}
