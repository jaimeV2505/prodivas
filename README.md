# Pro Diva Melide · Sistema de reservas

Web + reservas online para el centro de estética Pro Diva (Melide).
Next.js 15 · React 19 · TypeScript · PostgreSQL · Framer Motion · Docker (local) · Vercel (producción).

## Qué hace

- La clienta elige **servicio → (profesional) → día y hora → datos** y recibe confirmación con código.
- **Huecos libres en tiempo real**: los ocupados salen tachados con candado; se refrescan solos cada 15 s.
- **Bloqueo del hueco**: al pulsar un hueco se bloquea 10 min para esa clienta (cuenta atrás visible).
  Si cierra la pestaña, el hueco se libera al instante; si no confirma, caduca solo.
- **Imposible reservar dos veces lo mismo**: el candado vive en PostgreSQL (`EXCLUDE USING gist`), no solo en el código.
  Aunque dos personas pulsen a la vez, una gana y la otra recibe "ese hueco acaba de ocuparse".
- Respeta horario, pausa de mediodía, bloqueos (vacaciones/festivos), preaviso mínimo y duración de cada servicio.
- La clienta puede cancelar desde su enlace (hasta 24 h antes). Añadir al calendario (.ics) y aviso por WhatsApp.
- **Panel `/admin`**: agenda por día, citas manuales (teléfono/WhatsApp), cancelar, bloquear horarios.
- Notificaciones por WhatsApp, SMS, email y Telegram, con recordatorio y confirmación (ver más abajo).
- Mini-app instalable `/cita` en modo fácil.

## Arrancar en local con Docker

```bash
unzip prodiva-booking.zip && cd prodiva-booking   # unzip en terminal: conserva los archivos ocultos
cp .env.example .env                               # pon ADMIN_PASSWORD y SESSION_SECRET
docker compose up --build
```
- Web: http://localhost:3100 · Reservas: http://localhost:3100/reservar · Agenda: http://localhost:3100/admin (puerto configurable con `WEB_PORT`)
- La primera vez se crea el esquema y se cargan servicios y horarios de ejemplo.

Desarrollo con recarga en caliente:
```bash
docker compose up db -d
npm install && cp .env.example .env
npm run db:migrate && npm run dev
```

## Desplegar en Vercel

1. Sube el proyecto a GitHub e impórtalo en Vercel.
2. Añade una base de datos Postgres desde Vercel → Storage / Marketplace (Neon). Copia la cadena de conexión *pooled* a `DATABASE_URL`.
3. Variables de entorno: `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `WHATSAPP_NUMBER`,
   y opcionalmente `OWNER_EMAIL`, `RESEND_API_KEY`, `MAIL_FROM`, `NEXT_PUBLIC_SITE_URL` (tu dominio, para los enlaces de los emails).
4. Deploy. El script `vercel-build` ejecuta `scripts/migrate.mjs` antes de compilar: crea el esquema (idempotente) y carga los datos de ejemplo solo si la tabla de servicios está vacía.

## Notificaciones y recordatorios (evitar huecos y "no shows")

**Qué pasa con cada cita**

1. **Al reservar:** confirmación a la clienta (WhatsApp, o SMS si no hay WhatsApp; email además si lo dejó) y aviso instantáneo a la dueña por Telegram.
2. **4 horas antes** (`REMINDER_HOURS_BEFORE`): mensaje "¿Vienes hoy a las 17:00?" con **Confirmar / Cancelar**. Nunca de madrugada: si caería antes de las 08:30, se envía la tarde anterior a las 19:00. Las citas reservadas con menos de 5 h de antelación no llevan recordatorio.
3. **Si cancela:** el hueco se libera al instante y la dueña recibe "Hueco libre hoy a las 17:00" para poder ofrecérselo a otra persona.
4. **Si no responde:** una hora después del recordatorio, la dueña recibe "Sin respuesta, llámala" con el teléfono. En la agenda de `/admin` cada cita muestra *Ha confirmado / Sin respuesta / Recordatorio pendiente*.

Las citas **no se cancelan solas**: decide siempre la dueña. Cancelar desde el recordatorio se permite siempre (aunque falten pocas horas), porque un hueco avisado a tiempo se puede volver a vender.

**Canales** (cada uno se activa solo si pones sus variables en `.env` / Vercel; puedes empezar solo con Telegram + SMS):

| Canal | Para quién | Variables | Notas |
| --- | --- | --- | --- |
| Telegram | dueña | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | gratis; lo más rápido para empezar |
| Email (Resend) | clienta y dueña | `RESEND_API_KEY`, `MAIL_FROM`, `OWNER_EMAIL` | necesita dominio verificado |
| SMS (Twilio) | clienta | `TWILIO_*` | con enlace de un toque; tiene coste por mensaje |
| WhatsApp Business (Meta) | clienta | `WHATSAPP_*`, `WA_TEMPLATE_*` | botones Confirmar/Cancelar dentro del chat; requiere cuenta de empresa y plantillas aprobadas |

Cada mensaje lleva además un **enlace de un toque** (`/c/CÓDIGO?t=…`) a una pantalla con dos botones enormes. El enlace nunca confirma ni cancela por sí solo: hay que pulsar el botón (así los antivirus de correo no lo activan).

**Plantillas de WhatsApp** (créalas en Meta Business Manager, categoría *Utilidad*, idioma *Español*):

- `cita_confirmada`, cuerpo: `Hola {{1}}, tu cita en Pro Diva está confirmada: {{2}}, {{3}}. Te avisaremos el mismo día para que confirmes que vienes.` Botón URL: `https://TU-DOMINIO/c/{{1}}` (texto "Ver o cancelar").
- `recordatorio_cita`, cuerpo: `Hola {{1}}, te recordamos tu cita en Pro Diva: {{2}}, {{3}}. ¿Vienes?` Dos botones de respuesta rápida: "Confirmar" y "Cancelar".
- Webhook en Meta: `https://TU-DOMINIO/api/whatsapp/webhook` con tu `WHATSAPP_VERIFY_TOKEN`, suscrito al campo `messages`.

**Programar los recordatorios.** Hace falta que algo llame cada ~10 min a `/api/cron/reminders`.
Los *Cron Jobs* del plan Hobby de Vercel solo pueden ejecutarse una vez al día (compruébalo en la documentación actual) y un `vercel.json` con una frecuencia mayor **rompe el despliegue**, así que usamos GitHub Actions (incluido: `.github/workflows/reminders.yml`):

1. Define `CRON_SECRET` en Vercel (`openssl rand -hex 32`).
2. En GitHub → Settings → Secrets and variables → Actions crea `CRON_SECRET` (el mismo valor) y `SITE_URL` (`https://prodivas.vercel.app`).
3. Prueba a mano: pestaña *Actions* → *Recordatorios* → *Run workflow*. Respuesta esperada: `{"ok":true,"reminded":0,"failed":0,"alerted":0}`.

GitHub puede retrasar unos minutos las ejecuciones programadas y desactiva los workflows de repos sin actividad durante 60 días. Alternativa: cron-job.org (gratis) con `POST` y la cabecera `Authorization: Bearer <CRON_SECRET>`.

En local: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/reminders`.

## Lista de espera (rellena los huecos que se liberan)

- Cuando una clienta no encuentra hueco, en la reserva (y en el modo fácil) puede pulsar **"Avísame si se libera"**: nombre, teléfono y, si quiere, mañana o tarde. Puede esperar un día concreto o *cualquier día de las próximas dos semanas*.
- **Cuando alguien cancela** (desde el recordatorio, desde su enlace o desde `/admin`), el sistema comprueba con el motor de huecos que el servicio de cada persona en espera **de verdad cabe** y avisa a las tres primeras por orden de llegada (WhatsApp o SMS, y email si lo dejó) con un enlace corto `/hueco/…` que abre la reserva con el servicio y el día ya elegidos. Quien reserve antes se lo queda; el bloqueo de huecos impide dobles reservas.
- La dueña recibe por Telegram: quién se apunta y a cuántas personas se ha avisado. En `/admin` hay un panel con la lista (llamar, WhatsApp, quitar).
- Cuando una persona reserva, deja de esperar ese día. Los avisos de días pasados, y los de "cualquier día" con más de 14 días, caducan solos.
- Plantilla de WhatsApp (Utilidad, Español) `hueco_libre`: `Hola {{1}}, se ha liberado un hueco para {{2}}: {{3}}. Resérvalo antes de que se ocupe.` Botón URL: `https://TU-DOMINIO/hueco/{{1}}`. Si Meta la clasifica como *Marketing*, funcionará igual pero con otra tarifa y requisitos.

## App de reserva fácil (`/cita`)

Una versión aparte, **solo para pedir cita**, pensada para quien no se maneja con la web:
una pregunta por pantalla, botones enormes, sin calendario, con "Llamar" siempre visible, y recuerda la cita en el móvil.
Es una **PWA instalable**: se añade a la pantalla de inicio con su icono y se abre a pantalla completa.

- Dirección para compartir o imprimir en el centro: `https://prodivas.vercel.app/cita` (genera un código QR con cualquier generador gratuito).
- Android (Chrome): botón *Instalar en mi móvil*. iPhone (Safari): *Compartir → Añadir a pantalla de inicio*.
- Los iconos están en `public/icons`; cámbialos por el logo real cuando lo tengas.

## ⚠️ Antes de publicar: ajusta tus datos

`db/seed.sql` trae **precios, duraciones y horarios de ejemplo** (no los conozco). Edítalo **antes del primer arranque**.
Si ya arrancaste, cámbialos con SQL, por ejemplo:

```sql
UPDATE services SET price_cents = 2000, duration_min = 50 WHERE slug = 'manicura-semipermanente';
UPDATE business_hours SET open_time = '09:30', close_time = '19:30' WHERE weekday BETWEEN 1 AND 5;
INSERT INTO staff (name, sort) VALUES ('Nombre', 2);   -- 2.ª profesional: aparece el paso "¿Con quién?"
```
Reglas del salón (paso de los huecos, preaviso, días máximos, duración del bloqueo) en `.env`.

## Cómo funciona el bloqueo

1. `GET /api/availability` genera la parrilla (horario − pausa − bloqueos − citas) en una sola consulta SQL.
2. `POST /api/holds` crea una fila `HOLD` con caducidad. La restricción `bookings_no_overlap` impide solapes.
3. `POST /api/bookings` confirma (`HOLD → CONFIRMED`) con los datos de la clienta. Si el bloqueo caducó pero el hueco sigue libre, se recupera; si no, avisa.
4. Anti-abuso: máximo 3 bloqueos vivos por IP, campo trampa (honeypot) y validación en servidor.

## Limitaciones conocidas / siguientes pasos

- Todas las profesionales comparten el mismo horario (el horario individual sería una tabla más).
- Los servicios y horarios se editan por SQL; una pantalla en `/admin` es el siguiente paso natural.
- No hay pagos ni señal online (se puede añadir con Stripe).
- Vídeos y animaciones: la web trae 7 ranuras de vídeo (hero, 3 paneles de servicios, 3 reels) con fondo animado de respaldo. Ver `HIGGSFIELD.md`.
