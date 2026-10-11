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

-- =====================================================================
-- Reserva más completa: extras, packs, consentimientos, retoque y señal inteligente
-- =====================================================================

-- Los extras (retirada de esmalte, nail art…) se guardan como filas de la cita, sin servicio asociado
ALTER TABLE booking_services ALTER COLUMN service_id DROP NOT NULL;
ALTER TABLE booking_services ADD COLUMN IF NOT EXISTS is_addon boolean NOT NULL DEFAULT false;

-- Extras que suman tiempo y precio a una visita
CREATE TABLE IF NOT EXISTS addons (
  id           serial PRIMARY KEY,
  slug         text    NOT NULL UNIQUE,
  name         text    NOT NULL,
  description  text,
  duration_min int     NOT NULL CHECK (duration_min > 0),
  price_cents  int     NOT NULL CHECK (price_cents >= 0),
  category     text,                       -- solo se ofrece con servicios de esta categoría (NULL = con cualquiera)
  i18n         jsonb   NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true,
  sort         int     NOT NULL DEFAULT 100
);
INSERT INTO addons (slug, name, description, duration_min, price_cents, category, i18n, sort)
SELECT * FROM (VALUES
  ('retirada-semipermanente', 'Retirada de semipermanente', 'Si llevas esmalte semipermanente de otro sitio o de hace semanas.', 15, 500, 'Manicura y pedicura',
    '{"en":{"name":"Gel polish removal","description":"If you are wearing gel polish from elsewhere or from weeks ago."},"gl":{"name":"Retirada de semipermanente","description":"Se levas esmalte semipermanente doutro sitio ou de hai semanas."}}'::jsonb, 10),
  ('nail-art-sencillo', 'Nail art sencillo', 'Un detalle en unas pocas uñas: puntitos, línea fina, micro french.', 15, 500, 'Manicura y pedicura',
    '{"en":{"name":"Simple nail art","description":"A small detail on a few nails: dots, fine line, micro french."},"gl":{"name":"Nail art sinxelo","description":"Un detalle nalgunhas unllas: puntiños, liña fina, micro french."}}'::jsonb, 20),
  ('nail-art-elaborado', 'Nail art elaborado', 'Diseño trabajado en todas las uñas.', 30, 1000, 'Manicura y pedicura',
    '{"en":{"name":"Detailed nail art","description":"Detailed design on all nails."},"gl":{"name":"Nail art elaborado","description":"Deseño traballado en todas as unllas."}}'::jsonb, 30),
  ('parafina', 'Hidratación con parafina', 'Manos o pies muy suaves.', 10, 400, 'Manicura y pedicura',
    '{"en":{"name":"Paraffin treatment","description":"Very soft hands or feet."},"gl":{"name":"Hidratación con parafina","description":"Mans ou pés moi suaves."}}'::jsonb, 40),
  ('tinte-pestanas', 'Tinte de pestañas', 'Pestañas más oscuras y definidas.', 15, 500, 'Mirada',
    '{"en":{"name":"Lash tint","description":"Darker, more defined lashes."},"gl":{"name":"Tinte de pestanas","description":"Pestanas máis escuras e definidas."}}'::jsonb, 50)
) AS v(slug, name, description, duration_min, price_cents, category, i18n, sort)
WHERE NOT EXISTS (SELECT 1 FROM addons);

-- Packs: combinaciones ya pensadas (con descuento opcional; 0 = sin descuento). Ejemplos: ajústalos en /admin/ajustes
CREATE TABLE IF NOT EXISTS packages (
  id               serial PRIMARY KEY,
  slug             text    NOT NULL UNIQUE,
  name             text    NOT NULL,
  emoji            text    NOT NULL DEFAULT '✨',
  description      text,
  service_slugs    text[]  NOT NULL,
  discount_percent int     NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  i18n             jsonb   NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true,
  sort             int     NOT NULL DEFAULT 100
);
INSERT INTO packages (slug, name, emoji, description, service_slugs, discount_percent, i18n, sort)
SELECT * FROM (VALUES
  ('manos-y-pies', 'Manos y pies', '💅', 'Manicura y pedicura semipermanente, a juego y en una sola visita.', ARRAY['manicura-semipermanente','pedicura-semipermanente'], 0,
    '{"en":{"name":"Hands & feet","description":"Gel manicure and pedicure, matching, in a single visit."},"gl":{"name":"Mans e pés","description":"Manicura e pedicura semipermanente, a xogo e nunha soa visita."}}'::jsonb, 10),
  ('mirada-completa', 'Mirada completa', '👁️', 'Lifting de pestañas, tinte y diseño de cejas: mirada de revista.', ARRAY['lifting-pestanas','tinte-cejas','hilo-cejas'], 0,
    '{"en":{"name":"Complete eye look","description":"Lash lift, brow tint and brow shaping: magazine-ready eyes."},"gl":{"name":"Mirada completa","description":"Lifting de pestanas, tinte e deseño de cellas: mirada de revista."}}'::jsonb, 20),
  ('express', 'Express', '⚡', 'Manicura clásica y cejas con hilo: lo básico en una visita corta.', ARRAY['manicura-clasica','hilo-cejas'], 0,
    '{"en":{"name":"Express","description":"Classic manicure and threaded brows: the essentials in a short visit."},"gl":{"name":"Exprés","description":"Manicura clásica e cellas con fío: o básico nunha visita curta."}}'::jsonb, 30)
) AS v(slug, name, emoji, description, service_slugs, discount_percent, i18n, sort)
WHERE NOT EXISTS (SELECT 1 FROM packages);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS package_slug text;
-- Solo se guarda QUE confirmó las casillas de seguridad (y cuándo), nunca datos de salud
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS consent_acks text[];
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS consent_at timestamptz;

-- Columnas nuevas de servicios. Los valores iniciales se ponen UNA sola vez (al crear la columna): si luego los cambias, no se pisan.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'consent_kind') THEN
    ALTER TABLE services ADD COLUMN consent_kind text;   -- 'laser' | 'microblading' | NULL
    UPDATE services SET consent_kind = 'laser' WHERE slug LIKE 'laser-%';
    UPDATE services SET consent_kind = 'microblading' WHERE slug = 'microblading';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'rebook_weeks') THEN
    ALTER TABLE services ADD COLUMN rebook_weeks int CHECK (rebook_weeks IS NULL OR rebook_weeks BETWEEN 1 AND 26);  -- semanas hasta el retoque
    UPDATE services SET rebook_weeks = 3 WHERE slug = 'manicura-semipermanente';
    UPDATE services SET rebook_weeks = 4 WHERE slug = 'pedicura-semipermanente';
    UPDATE services SET rebook_weeks = 6 WHERE slug = 'lifting-pestanas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'deposit_always') THEN
    ALTER TABLE services ADD COLUMN deposit_always boolean NOT NULL DEFAULT false;  -- señal para todas, aunque nunca hayan faltado
    UPDATE services SET deposit_always = true WHERE deposit_cents > 0;               -- se mantiene lo que había
  END IF;
END $$;

-- Señal inteligente: 'service' = como hasta ahora; 'repeat' = solo a quien ya ha faltado (y a los servicios marcados «siempre»)
INSERT INTO settings (key, value) VALUES ('deposit_policy', 'service') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('deposit_after_no_shows', '1') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('deposit_default_cents', '1000') ON CONFLICT (key) DO NOTHING;

-- Traducciones (inglés y gallego) de las tendencias de ejemplo
ALTER TABLE trends ADD COLUMN IF NOT EXISTS i18n jsonb NOT NULL DEFAULT '{}';
UPDATE trends SET i18n = '{"en":{"title":"Burgundy with a glow finish","body":"Burgundy and wine shades rule this autumn, best with a glow top coat for a flawless shine."},"gl":{"title":"Burdeos con brillo glow","body":"Os tons burdeos e viño mandan este outono, mellor cun top coat glow para un brillo impecable."}}'::jsonb
  WHERE title = 'Burdeos con brillo glow' AND i18n = '{}'::jsonb;
UPDATE trends SET i18n = '{"en":{"title":"Chocolate brown and latte","body":"Chocolate brown, latte and caramel are the warm neutrals of the season. Quiet luxury on your nails."},"gl":{"title":"Marrón chocolate e latte","body":"O marrón chocolate, o café con leite e o caramelo son os neutros cálidos da tempada. Luxo silencioso nas unllas."}}'::jsonb
  WHERE title = 'Marrón chocolate y latte' AND i18n = '{}'::jsonb;
UPDATE trends SET i18n = '{"en":{"title":"Mauve and dusty pink","body":"Dusty pinks and mauves: soft but with personality, perfect for the shift from summer to autumn."},"gl":{"title":"Malva e rosa empoeirado","body":"Rosas empoeirados e malvas: suaves pero con personalidade, perfectos para pasar do verán ao outono."}}'::jsonb
  WHERE title = 'Malva y rosa empolvado' AND i18n = '{}'::jsonb;
UPDATE trends SET i18n = '{"en":{"title":"Olive or moss green","body":"Olive and moss green sneak in as the sensation of the season: calm and very original."},"gl":{"title":"Verde oliva ou musgo","body":"O verde oliva e o verde musgo cólanse como sensación da tempada: calma e moita orixinalidade."}}'::jsonb
  WHERE title = 'Verde oliva o musgo' AND i18n = '{}'::jsonb;
UPDATE trends SET i18n = '{"en":{"title":"Micro french and dots","body":"Discreet designs: micro french, fine lines, dots or a detail on a single nail. Little, but very well done."},"gl":{"title":"Micro french e puntiños","body":"Deseños discretos: micro french, liñas finas, puntiños ou un detalle nunha soa unlla. Pouco, pero moi ben feito."}}'::jsonb
  WHERE title = 'Micro french y puntitos' AND i18n = '{}'::jsonb;
UPDATE trends SET i18n = '{"en":{"title":"Short or medium nails","body":"Short or medium nails are the most practical of the autumn, and with a good colour they look very elegant."},"gl":{"title":"Unllas curtas ou medias","body":"As unllas curtas ou medias son as máis prácticas do outono e cunha boa cor ven moi elegantes."}}'::jsonb
  WHERE title = 'Uñas cortas o medias' AND i18n = '{}'::jsonb;
UPDATE trends SET i18n = '{"en":{"title":"Lash lift","body":"Open, awake eyes without extensions or mascara. The effect usually lasts 6 to 8 weeks."},"gl":{"title":"Lifting de pestanas","body":"Mirada aberta e esperta sen extensións nin máscara. O efecto adoita durar entre 6 e 8 semanas."}}'::jsonb
  WHERE title = 'Lifting de pestañas' AND i18n = '{}'::jsonb;
UPDATE trends SET i18n = '{"en":{"title":"Natural, luminous brows","body":"Natural but well-groomed brows, a little lighter and less sharply defined. Goodbye to ultra-defined brows."},"gl":{"title":"Cellas naturais e luminosas","body":"Cellas naturais pero coidadas, un pouco máis claras e menos marcadas. Adeus ás cellas ultradefinidas."}}'::jsonb
  WHERE title = 'Cejas naturales y luminosas' AND i18n = '{}'::jsonb;

-- =====================================================================
-- Cancelaciones: política por servicio, motivo, citas por mover (cerrar el día)
-- =====================================================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_why text;                           -- sick | work | other
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_free boolean NOT NULL DEFAULT false; -- el centro pide moverla: sin plazo y sin penalización
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS centre_note text;                          -- mensaje del centro (cerrar el día)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'cancel_notice_hours') THEN
    -- horas de antelación para cancelar sin perder la señal (NULL = la regla general)
    ALTER TABLE services ADD COLUMN cancel_notice_hours int CHECK (cancel_notice_hours IS NULL OR cancel_notice_hours BETWEEN 0 AND 168);
    UPDATE services SET cancel_notice_hours = 48 WHERE consent_kind IS NOT NULL;  -- láser y microblading: 48 h
  END IF;
END $$;

-- =====================================================================
-- Notificaciones: idioma por cita, recordatorio en dos pasos, después de la visita, valoraciones y baja
-- =====================================================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'es' CHECK (lang IN ('es','gl','en'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_prev_sent_at  timestamptz;       -- recordatorio de la víspera
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_prev_attempts int NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS aftercare_sent_at      timestamptz;       -- gracias + cuidados + valoración
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rebook_nudge_sent_at   timestamptz;       -- «toca retoque»
ALTER TABLE customers ADD COLUMN IF NOT EXISTS optout_at timestamptz;                   -- «BAJA»: sin mensajes opcionales
ALTER TABLE waitlist  ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'es' CHECK (lang IN ('es','gl','en'));

-- Cuidados posteriores por servicio (texto libre en castellano; editable en /admin/ajustes)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'services' AND column_name = 'aftercare') THEN
    ALTER TABLE services ADD COLUMN aftercare text;
    UPDATE services SET aftercare = 'Evita el agua muy caliente y los productos de limpieza sin guantes las primeras 24 horas. Hidrata las cutículas con aceite cada noche y no uses las uñas como herramienta.' WHERE slug IN ('manicura-semipermanente','pedicura-semipermanente');
    UPDATE services SET aftercare = 'Evita mojar las pestañas y el vapor durante 24 horas, y no uses rizador ni máscara en ese tiempo.' WHERE slug = 'lifting-pestanas';
    UPDATE services SET aftercare = 'Durante 7 días no mojes ni rasques la zona y aplica solo lo que te indicamos. Evita sol, sauna y piscina dos semanas.' WHERE slug = 'microblading';
    UPDATE services SET aftercare = 'Evita el sol directo y la cabina en la zona y mantenla hidratada con una crema calmante.' WHERE slug LIKE 'laser-%';
  END IF;
END $$;

-- Valoraciones: privadas primero; si son buenas se invita a dejarla en Google
CREATE TABLE IF NOT EXISTS reviews (
  id             bigserial PRIMARY KEY,
  booking_id     uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  rating         int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text,
  google_clicked boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Packs por ocasión, para dos, de temporada y destacados; sellos de fidelidad
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'packages' AND column_name = 'occasion') THEN
    ALTER TABLE packages ADD COLUMN occasion text;                                              -- «Boda», «Camino»…: se muestra como etiqueta
    ALTER TABLE packages ADD COLUMN people int NOT NULL DEFAULT 1 CHECK (people IN (1, 2));      -- 2 = para dos: los servicios se hacen dos veces (ella y su acompañante)
    ALTER TABLE packages ADD COLUMN starts_on date;                                              -- de temporada: solo se ofrece entre estas fechas
    ALTER TABLE packages ADD COLUMN ends_on date;
    ALTER TABLE packages ADD COLUMN featured boolean NOT NULL DEFAULT false;                     -- «pack del mes»
    -- Dos packs de ejemplo (sin descuento; los ajustas en /admin/ajustes)
    INSERT INTO packages (slug, name, emoji, description, service_slugs, discount_percent, people, i18n, sort)
    VALUES ('madre-e-hija', 'Madre e hija', '👩‍👧', 'Manicura clásica para las dos, una detrás de otra.', ARRAY['manicura-clasica'], 0, 2,
      '{"en":{"name":"Mother and daughter","description":"Classic manicure for both of you, one after the other."},"gl":{"name":"Nai e filla","description":"Manicura clásica para as dúas, unha detrás da outra."}}'::jsonb, 40)
    ON CONFLICT (slug) DO NOTHING;
    INSERT INTO packages (slug, name, emoji, description, service_slugs, discount_percent, occasion, i18n, sort)
    VALUES ('invitada-de-boda', 'Invitada de boda', '👗', 'Manos y pies a juego y cejas: para llegar perfecta.', ARRAY['manicura-semipermanente','pedicura-semipermanente','hilo-cejas'], 0, 'Boda',
      '{"en":{"name":"Wedding guest","description":"Matching hands and feet plus brows: arrive looking perfect.","occasion":"Wedding"},"gl":{"name":"Invitada de voda","description":"Mans e pés a xogo e cellas: para chegar perfecta.","occasion":"Voda"}}'::jsonb, 50)
    ON CONFLICT (slug) DO NOTHING;
  END IF;
END $$;

-- Fidelidad: cada N visitas, un premio (se canjea a mano desde la ficha de la clienta)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_redeemed int NOT NULL DEFAULT 0;
INSERT INTO settings (key, value) VALUES ('loyalty_enabled', 'off') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('loyalty_every', '10') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('loyalty_reward', 'una manicura clásica gratis') ON CONFLICT (key) DO NOTHING;
