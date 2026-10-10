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
- Emails opcionales (Resend) a la dueña y a la clienta.

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
