import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";
import CookieChoice from "@/components/CookieChoice";

export const metadata: Metadata = {
  title: "Política de cookies",
  description: "Qué se guarda en tu dispositivo cuando usas la web de Pro Diva Melide y cómo cambiar tu elección.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return (
    <LegalShell title="Política de cookies y almacenamiento">
      <h2>En pocas palabras</h2>
      <p>
        No usamos cookies de publicidad ni de terceros. Solo guardamos en tu móvil lo imprescindible para que la reserva funcione y, <strong>únicamente si aceptas</strong>, un identificador anónimo para medir cómo mejorar la reserva.
      </p>

      <h2>Lo estrictamente necesario (siempre activo)</h2>
      <table>
        <thead>
          <tr><th>Qué</th><th>Para qué</th><th>Duración</th></tr>
        </thead>
        <tbody>
          <tr><td>Datos de tus citas y preferencias en el navegador (almacenamiento local)</td><td>Mostrarte «Tus citas», repetir tu última cita y proponerte el retoque.</td><td>Hasta que lo borres</td></tr>
          <tr><td><code>pd_admin</code> (solo personal del centro)</td><td>Mantener la sesión del panel.</td><td>7 días</td></tr>
          <tr><td><code>pd_consent</code></td><td>Recordar tu elección sobre esta página.</td><td>Hasta que lo borres</td></tr>
        </tbody>
      </table>

      <h2>Medición anónima (solo si aceptas)</h2>
      <p>
        Contamos pasos de la reserva (servicio elegido, hueco, confirmación), el tipo de dispositivo y de qué enlace vienes (por ejemplo, Instagram). Nunca enviamos tu nombre, teléfono ni email. Si aceptas, guardamos un identificador aleatorio en tu dispositivo para unir los pasos de una misma visita; si eliges «Solo lo necesario», ese identificador vive solo en la memoria de la página y desaparece al cerrarla, sin guardar nada.
      </p>

      <h2>Cambia tu elección</h2>
      <CookieChoice />

      <h2>Cómo borrar lo guardado</h2>
      <p>Desde los ajustes de tu navegador puedes eliminar los datos de este sitio en cualquier momento. Si lo haces, perderás el listado local de «Tus citas» (tus citas siguen guardadas en el centro y accesibles desde el enlace de cada mensaje).</p>
    </LegalShell>
  );
}
