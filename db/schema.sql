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
