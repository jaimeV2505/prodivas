import type { Metadata } from "next";
import LegalShell from "@/components/LegalShell";
import { LEGAL, RETENCION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Cómo trata Pro Diva Melide tus datos personales: qué recogemos, para qué, cuánto tiempo y cómo ejercer tus derechos.",
  alternates: { canonical: "/privacidad" },
};

export default function PrivacidadPage() {
  return (
    <LegalShell title="Política de privacidad">
      <h2>1. Responsable del tratamiento</h2>
      <p>
        <strong>{LEGAL.titular}</strong> · NIF {LEGAL.nif} · {LEGAL.nombreComercial}, {LEGAL.direccionSalon}. Teléfono {LEGAL.telefono}. Email de contacto: {LEGAL.email}.
      </p>

      <h2>2. Qué datos recogemos</h2>
      <ul>
        <li><strong>Para reservar:</strong> nombre, teléfono, email (opcional) y las notas que quieras dejarnos (por ejemplo, el color de esmalte).</li>
        <li><strong>Historial de citas:</strong> servicios, fechas, si acudiste o no, señales abonadas y mensajes que te hemos enviado.</li>
        <li><strong>Casillas de seguridad</strong> de tratamientos como láser o microblading: guardamos <em>únicamente</em> que las marcaste y cuándo. No recogemos datos de salud en la web; si hiciera falta una ficha clínica, se haría en el centro y con su propia información.</li>
        <li><strong>Valoraciones:</strong> la puntuación y el comentario que decidas dejarnos.</li>
        <li><strong>Medición anónima de la web:</strong> pasos que se dan en la reserva (servicio elegido, hueco, confirmación), tipo de dispositivo y de dónde llega la visita. Sin nombre, teléfono ni email. Ver <a href="/cookies">política de cookies</a>.</li>
        <li><strong>Si dejas tu teléfono y no terminas la reserva:</strong> lo guardamos para escribirte, una sola vez, por si quieres retomarla.</li>
      </ul>

      <h2>3. Para qué los usamos y con qué base jurídica</h2>
      <table>
        <thead>
          <tr><th>Finalidad</th><th>Base jurídica</th></tr>
        </thead>
        <tbody>
          <tr><td>Gestionar tu cita: confirmarla, recordártela, cambiarla o cancelarla, y cobrar o devolver la señal.</td><td>Ejecución del servicio que nos pides (art. 6.1.b RGPD).</td></tr>
          <tr><td>Evitar reservas fraudulentas o abusivas (límites, verificación del teléfono, control de plantones).</td><td>Interés legítimo en proteger la agenda (art. 6.1.f).</td></tr>
          <tr><td>Mensajes opcionales: cuidados tras la visita, aviso de retoque, «te echamos de menos», avisos de huecos libres.</td><td>Interés legítimo en mantener la relación con clientas (art. 6.1.f y art. 21.2 LSSI) y, para la lista de espera, tu petición. Puedes darte de baja en cualquier momento.</td></tr>
          <tr><td>Recuperar una reserva que dejaste a medias (un único mensaje).</td><td>Tu consentimiento al dejar el teléfono (art. 6.1.a).</td></tr>
          <tr><td>Medición anónima y mejora de la web.</td><td>Tu consentimiento si se guarda algo en tu dispositivo (art. 6.1.a); sin él, solo estadística anónima en memoria.</td></tr>
          <tr><td>Obligaciones fiscales y contables.</td><td>Obligación legal (art. 6.1.c).</td></tr>
        </tbody>
      </table>

      <h2>4. Destinatarios</h2>
      <p>No vendemos tus datos. Para prestar el servicio usamos proveedores que los tratan por nuestra cuenta, con contrato de encargado del tratamiento:</p>
      <ul>
        <li><strong>Vercel y Neon:</strong> alojamiento de la web y de la base de datos.</li>
        <li><strong>Stripe:</strong> cobro de la señal con tarjeta (solo si el servicio la pide). No vemos los datos de tu tarjeta.</li>
        <li><strong>Twilio:</strong> envío de SMS.</li>
        <li><strong>Meta (WhatsApp Business):</strong> envío de WhatsApp y recepción de tus respuestas «Confirmar» / «Cancelar».</li>
        <li><strong>Resend:</strong> envío de emails.</li>
        <li><strong>Telegram:</strong> avisos internos a la responsable del centro (nombre, hora y servicio de la cita).</li>
      </ul>
      <p>Algunos de estos proveedores pueden tratar datos fuera del Espacio Económico Europeo con las garantías previstas en el RGPD (cláusulas contractuales tipo o decisión de adecuación).</p>

      <h2>5. Cuánto tiempo los conservamos</h2>
      <ul>
        <li><strong>Fichas y citas:</strong> {RETENCION.fichas}.</li>
        <li><strong>Teléfonos dejados sin reservar:</strong> {RETENCION.leads}.</li>
        <li><strong>Registro de mensajes enviados:</strong> {RETENCION.mensajes}.</li>
        <li>Los datos que la ley fiscal nos obliga a guardar (facturas) se conservan durante los plazos legales.</li>
      </ul>

      <h2>6. Tus derechos</h2>
      <p>
        Puedes pedirnos acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {LEGAL.email} o llamando al {LEGAL.telefono}. Te responderemos en un mes. Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" rel="noopener noreferrer" target="_blank">aepd.es</a>).
      </p>

      <h2>7. Mensajes opcionales y baja</h2>
      <p>
        Los avisos de tu cita (confirmación, recordatorios, cambios y cancelaciones) son necesarios para el servicio y no se pueden desactivar. Los mensajes opcionales llevan un enlace de baja firmado, y también puedes responder <strong>BAJA</strong> o <strong>STOP</strong> a nuestro WhatsApp. Si te das de baja, no volvemos a escribirte salvo por las citas que tengas.
      </p>

      <h2>8. Seguridad</h2>
      <p>Usamos conexiones cifradas, enlaces de gestión con código secreto, accesos de administración protegidos y limitamos quién puede ver tus datos dentro del centro.</p>
    </LegalShell>
  );
}
