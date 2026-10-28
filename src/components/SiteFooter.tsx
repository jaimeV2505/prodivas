import Link from "next/link";

/** Pie compacto para las páginas interiores (la portada tiene el suyo, con los mismos enlaces legales). */
export default function SiteFooter() {
  return (
    <footer className="footer footer--slim">
      <div className="container footer__in">
        <p>© {new Date().getFullYear()} Pro Diva · Melide</p>
        <span>
          <Link href="/privacidad">Privacidad</Link> · <Link href="/aviso-legal">Aviso legal</Link> · <Link href="/cookies">Cookies</Link>
        </span>
      </div>
    </footer>
  );
}
