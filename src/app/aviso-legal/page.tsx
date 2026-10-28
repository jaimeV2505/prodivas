import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Aviso legal",
  description: "Datos del titular de la web de Pro Diva Melide y condiciones de uso.",
  alternates: { canonical: "/aviso-legal" },
};

export default function AvisoLegalPage() {
  return (
    <LegalShell title="Aviso legal">
      <h2>1. Datos del titular</h2>
      <p>En cumplimiento del artículo 10 de la Ley 34/2002 (LSSI-CE), te informamos de que esta web pertenece a:</p>
      <ul>
        <li><strong>Titular:</strong> {LEGAL.titular}</li>
        <li><strong>NIF/CIF:</strong> {LEGAL.nif}</li>
        <li><strong>Domicilio fiscal:</strong> {LEGAL.domicilioFiscal}</li>
        <li><strong>Establecimiento:</strong> {LEGAL.nombreComercial}, {LEGAL.direccionSalon}</li>
        <li><strong>Teléfono:</strong> {LEGAL.telefono}</li>
        <li><strong>Email:</strong> {LEGAL.email}</li>
        <li><strong>Registro:</strong> {LEGAL.registro}</li>
      </ul>

      <h2>2. Objeto y uso de la web</h2>
      <p>
        La web ofrece información sobre los servicios del centro y permite reservar citas online. El uso de la web implica aceptar este aviso. Te comprometes a dar datos verídicos al reservar, a no reservar a nombre de otra persona sin que lo sepa y a no usar la web para fines ilícitos o que perjudiquen su funcionamiento.
      </p>

      <h2>3. Reservas, señal y cancelaciones</h2>
      <p>
        Una reserva queda confirmada cuando recibes el código de cita. Algunos servicios (por ejemplo, láser o microblading) pueden requerir el pago de una señal que se descuenta del precio final. Los plazos para cancelar o cambiar la hora, y las condiciones de devolución de la señal, se muestran antes de confirmar y en el enlace de gestión de tu cita. Si el centro cancela o cierra un día, la señal se devuelve siempre.
      </p>

      <h2>4. Precios</h2>
      <p>Los precios de la web incluyen impuestos y son orientativos para servicios que dependan de una valoración previa; el precio final se confirma en el centro antes de empezar el tratamiento.</p>

      <h2>5. Propiedad intelectual</h2>
      <p>Los textos, imágenes, marca y diseño de la web son del titular o se usan con licencia. No se pueden reproducir ni distribuir sin permiso.</p>

      <h2>6. Responsabilidad</h2>
      <p>Hacemos lo posible por mantener la web disponible y actualizada, pero no garantizamos que esté libre de errores o interrupciones. Los enlaces a terceros (Instagram, Google, WhatsApp) se rigen por sus propias condiciones.</p>

      <h2>7. Legislación y jurisdicción</h2>
      <p>Este aviso se rige por la ley española. Para cualquier controversia, y si eres consumidora, serán competentes los juzgados de tu domicilio. Puedes acudir también a la plataforma europea de resolución de litigios en línea: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">ec.europa.eu/consumers/odr</a>.</p>
    </LegalShell>
  );
}
