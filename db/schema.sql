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
