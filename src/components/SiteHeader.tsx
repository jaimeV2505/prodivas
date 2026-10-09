import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header__in">
        <Link href="/" className="wordmark" aria-label="Pro Diva, inicio">
          <span className="wordmark__pro">Pro</span>
          <span className="wordmark__diva">Diva</span>
        </Link>
        <nav aria-label="Principal" className="site-nav">
          <Link href="/#servicios" className="site-nav__link">Servicios</Link>
          <Link href="/#donde" className="site-nav__link">Dónde estamos</Link>
          <Link href="/reservar" className="btn btn--primary btn--sm">Reservar cita</Link>
        </nav>
      </div>
    </header>
  );
}
