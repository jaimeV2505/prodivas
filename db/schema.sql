-- Pro Diva Melide · esquema de reservas (idempotente)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS staff (
  id      serial PRIMARY KEY,
  name    text    NOT NULL,
  active  boolean NOT NULL DEFAULT true,
  sort    int     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id           serial PRIMARY KEY,
  slug         text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  category     text    NOT NULL,
  description  text,
  duration_min int     NOT NULL CHECK (duration_min > 0),
  price_cents  int     NOT NULL CHECK (price_cents >= 0),
  active       boolean NOT NULL DEFAULT true,
  sort         int     NOT NULL DEFAULT 0
);

-- weekday: 0 = domingo ... 6 = sábado (igual que EXTRACT(DOW))
CREATE TABLE IF NOT EXISTS business_hours (
  weekday     int PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  closed      boolean NOT NULL DEFAULT false,
  open_time   time,
  close_time  time,
  break_start time,
  break_end   time
);

-- Vacaciones, festivos, citas médicas... (staff_id NULL = cierra todo el salón)
CREATE TABLE IF NOT EXISTS time_off (
  id        serial PRIMARY KEY,
  staff_id  int REFERENCES staff(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at   timestamptz NOT NULL CHECK (ends_at > starts_at),
  reason    text
);

CREATE TABLE IF NOT EXISTS bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE,
  staff_id        int  NOT NULL REFERENCES staff(id),
  service_id      int  NOT NULL REFERENCES services(id),
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL CHECK (ends_at > starts_at),
  status          text NOT NULL CHECK (status IN ('HOLD','CONFIRMED','CANCELLED','EXPIRED')),
  hold_expires_at timestamptz,
  hold_token      text NOT NULL,
  ip_hash         text,
  customer_name   text,
  customer_phone  text,
  customer_email  text,
  notes           text,
  source          text NOT NULL DEFAULT 'web',
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  cancelled_at    timestamptz,

  -- EL CANDADO: la base de datos impide que dos citas activas (HOLD o CONFIRMED)
  -- de la misma profesional se solapen, pase lo que pase en la aplicación.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('HOLD','CONFIRMED'))
);

CREATE INDEX IF NOT EXISTS bookings_starts_idx ON bookings (starts_at);
CREATE INDEX IF NOT EXISTS bookings_hold_ip_idx ON bookings (ip_hash) WHERE status = 'HOLD';
CREATE INDEX IF NOT EXISTS time_off_range_idx ON time_off (starts_at, ends_at);

-- ---------------------------------------------------------------------
-- Notificaciones y recordatorios (idempotente)
-- ---------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS remind_at         timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at  timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_attempts int NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_response text CHECK (customer_response IN ('CONFIRMED','CANCELLED'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS responded_at      timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason     text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS owner_alerted_at  timestamptz;

CREATE TABLE IF NOT EXISTS notification_log (
  id         bigserial PRIMARY KEY,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  channel    text NOT NULL,
  status     text NOT NULL CHECK (status IN ('SENT','FAILED')),
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_log_booking_idx ON notification_log (booking_id, created_at);
CREATE INDEX IF NOT EXISTS bookings_remind_idx ON bookings (remind_at)
  WHERE status = 'CONFIRMED' AND reminder_sent_at IS NULL;

-- ---------------------------------------------------------------------
-- Lista de espera: avisar cuando se libera un hueco
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   int  NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  day          date,                                   -- NULL = cualquier día de los próximos 14
  part         text NOT NULL DEFAULT 'ANY' CHECK (part IN ('ANY','MORNING','AFTERNOON')),
  name         text NOT NULL,
  phone        text NOT NULL,
  phone_key    text NOT NULL,                          -- últimos 9 dígitos, para comparar
  email        text,
  source       text NOT NULL DEFAULT 'web',            -- 'web' o 'app' (modo fácil)
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','NOTIFIED','BOOKED','CANCELLED')),
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  notified_at  timestamptz,
  notified_slot timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_unique_active
  ON waitlist (service_id, COALESCE(day, DATE '1970-01-01'), phone_key) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS waitlist_match_idx ON waitlist (status, day);

-- ---------------------------------------------------------------------
-- Huecos por servicio y "llámame"
-- ---------------------------------------------------------------------
-- Tamaño del hueco de cada servicio. NULL = igual que su duración (30 min de servicio = huecos de 30 min).
ALTER TABLE services ADD COLUMN IF NOT EXISTS slot_step_min int
  CHECK (slot_step_min IS NULL OR slot_step_min BETWEEN 5 AND 480);

CREATE TABLE IF NOT EXISTS callbacks (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL,
  ip_hash    text,
  status     text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','DONE')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS callbacks_status_idx ON callbacks (status, created_at);

-- ---------------------------------------------------------------------
-- Ajustes editables desde /admin/ajustes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- =====================================================================
-- FASE 2: varios servicios por visita, limpieza, señal, clientas,
--         asistencia, horarios por profesional y entrega de mensajes
-- =====================================================================
ALTER TABLE services ADD COLUMN IF NOT EXISTS buffer_min int NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 120);
ALTER TABLE services ADD COLUMN IF NOT EXISTS deposit_cents int NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0);

CREATE TABLE IF NOT EXISTS customers (
  id            bigserial PRIMARY KEY,
  phone_key     text NOT NULL UNIQUE,          -- últimos 9 dígitos
  name          text NOT NULL,
  phone         text NOT NULL,
  email         text,
  notes         text,
  no_show_count int  NOT NULL DEFAULT 0,
  visit_count   int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Tiempo bloqueado de una cita = duración + limpieza. El candado de la base de datos usa este rango.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS blocked_until timestamptz;
UPDATE bookings SET blocked_until = ends_at WHERE blocked_until IS NULL;

CREATE OR REPLACE FUNCTION bookings_set_blocked_until() RETURNS trigger AS $$
BEGIN
  IF NEW.blocked_until IS NULL THEN NEW.blocked_until := NEW.ends_at; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS bookings_blocked_until ON bookings;
CREATE TRIGGER bookings_blocked_until BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_set_blocked_until();
ALTER TABLE bookings ALTER COLUMN blocked_until SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap_v2') THEN
    ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap_v2 EXCLUDE USING gist (
      staff_id WITH =,
      tstzrange(starts_at, blocked_until, '[)') WITH &&
    ) WHERE (status IN ('HOLD','CONFIRMED'));
  END IF;
END $$;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES customers(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS attendance text CHECK (attendance IN ('SHOWED','NO_SHOW'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS attended_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_cents int NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'NONE'
  CHECK (deposit_status IN ('NONE','PENDING','PAID','REFUNDED','FORFEITED'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_session_id text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings (customer_id, starts_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_stripe_session_idx ON bookings (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- Servicios de cada visita, con foto del precio, duración y limpieza en el momento de reservar
CREATE TABLE IF NOT EXISTS booking_services (
  id            bigserial PRIMARY KEY,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id    int  NOT NULL REFERENCES services(id),
  position      int  NOT NULL,
  name          text NOT NULL,
  duration_min  int  NOT NULL,
  price_cents   int  NOT NULL,
  deposit_cents int  NOT NULL DEFAULT 0,
  buffer_min    int  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS booking_services_booking_idx ON booking_services (booking_id, position);
INSERT INTO booking_services (booking_id, service_id, position, name, duration_min, price_cents, deposit_cents, buffer_min)
SELECT b.id, b.service_id, 0, s.name, (EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 60)::int, s.price_cents, 0, 0
FROM bookings b JOIN services s ON s.id = b.service_id
WHERE NOT EXISTS (SELECT 1 FROM booking_services bs WHERE bs.booking_id = b.id);

-- Horario propio de una profesional (si no hay fila, usa el del salón)
CREATE TABLE IF NOT EXISTS staff_hours (
  staff_id    int NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday     int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  closed      boolean NOT NULL DEFAULT false,
  open_time   time,
  close_time  time,
  break_start time,
  break_end   time,
  PRIMARY KEY (staff_id, weekday)
);

-- Entrega de mensajes y respaldo por SMS
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS provider_id        text;
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS delivery_status    text;
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz;
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS fallback_sms       text;
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS fallback_phone     text;
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS fallback_done_at   timestamptz;
CREATE INDEX IF NOT EXISTS notification_log_provider_idx ON notification_log (provider_id) WHERE provider_id IS NOT NULL;

-- La lista de espera también puede ser de una visita con varios servicios (NULL = solo service_id)
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS service_ids int[];

-- Visita en horas distintas: varias citas (una por servicio) que comparten grupo
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS bookings_group_idx ON bookings (group_id) WHERE group_id IS NOT NULL;

-- Tendencias que cuenta el avatar (se editan en /admin/ajustes). Orientativas, otoño 2026.
CREATE TABLE IF NOT EXISTS trends (
  id           serial PRIMARY KEY,
  emoji        text NOT NULL DEFAULT '✨',
  title        text NOT NULL,
  body         text NOT NULL,
  topic        text NOT NULL DEFAULT 'general',   -- nails | lashes | brows | wax | general
  service_slug text,                              -- servicio que se puede añadir con un toque
  active       boolean NOT NULL DEFAULT true,
  sort         int NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Solo si la tabla está vacía (si las borras o editas, no vuelven a aparecer)
INSERT INTO trends (emoji, title, body, topic, service_slug, sort)
SELECT * FROM (VALUES
  ('🍷', 'Burdeos con brillo glow', 'Los tonos borgoña y burdeos mandan este otoño, y mejor con un top coat de acabado glow para un brillo impecable.', 'nails', 'manicura-semipermanente', 10),
  ('🍫', 'Marrón chocolate y latte', 'El marrón chocolate, el café con leche y el caramelo son los neutros cálidos de la temporada. Lujo silencioso en las uñas.', 'nails', 'manicura-semipermanente', 20),
  ('🌸', 'Malva y rosa empolvado', 'Rosas empolvados y malvas: suaves pero con personalidad, perfectos para pasar del verano al otoño.', 'nails', 'manicura-semipermanente', 30),
  ('🫒', 'Verde oliva o musgo', 'El verde oliva y el verde musgo se cuelan como sensación de la temporada: calma y mucha originalidad.', 'nails', 'manicura-semipermanente', 40),
  ('✨', 'Micro french y puntitos', 'Diseños discretos: micro french, líneas finas, puntitos o un detalle en una sola uña. Poco, pero muy bien hecho.', 'nails', 'manicura-clasica', 50),
  ('💅', 'Uñas cortas o medias', 'Las uñas cortas o medias son las más prácticas del otoño y con un buen color se ven elegantísimas.', 'nails', 'manicura-clasica', 60),
  ('👁️', 'Lifting de pestañas', 'Mirada abierta y despierta sin extensiones ni máscara. El efecto suele durar entre 6 y 8 semanas.', 'lashes', 'lifting-pestanas', 70),
  ('🪶', 'Cejas naturales y luminosas', 'Cejas naturales pero cuidadas, un poco más claras y menos marcadas. Adiós a las cejas ultradefinidas.', 'brows', 'hilo-cejas', 80)
) AS v(emoji, title, body, topic, service_slug, sort)
WHERE NOT EXISTS (SELECT 1 FROM trends);
