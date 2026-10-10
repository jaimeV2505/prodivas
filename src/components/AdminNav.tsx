import Link from "next/link";
import { logout } from "@/app/admin/actions";

const TABS = [
  { href: "/admin", key: "dia", label: "Hoy" },
  { href: "/admin/semana", key: "semana", label: "Semana" },
  { href: "/admin/clientas", key: "clientas", label: "Clientas" },
  { href: "/admin/ajustes", key: "ajustes", label: "Ajustes" },
];

export default function AdminNav({ active }: { active: "dia" | "semana" | "clientas" | "ajustes" | "cita" }) {
  return (
    <header className="admin__bar admin__bar--nav">
      <nav className="admin__tabs" aria-label="Panel">
        {TABS.map((t) => (
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
