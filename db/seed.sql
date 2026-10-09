-- Datos iniciales. SE EJECUTA SOLO SI LA TABLA services ESTÁ VACÍA.
-- ⚠️ Precios, duraciones y horarios son PLACEHOLDERS: ajústalos antes de publicar
--    (o edítalos después desde SQL / en este archivo antes del primer arranque).

INSERT INTO staff (name, sort) VALUES ('Pro Diva', 1);
-- Para varias profesionales añade más filas; el flujo de reserva mostrará
-- automáticamente el paso "Elige profesional".

INSERT INTO services (slug, name, category, description, duration_min, price_cents, sort) VALUES
  ('manicura-semipermanente', 'Manicura semipermanente', 'Manicura y pedicura', 'Limado, cutículas y esmaltado semipermanente.', 45, 1800, 10),
  ('manicura-clasica',        'Manicura clásica',        'Manicura y pedicura', 'Limado, cutículas y esmalte tradicional.',       30, 1200, 20),
  ('pedicura',                'Pedicura',                'Manicura y pedicura', 'Tratamiento completo de pies.',                   50, 2200, 30),
  ('pedicura-semipermanente', 'Pedicura semipermanente', 'Manicura y pedicura', 'Pedicura con esmaltado semipermanente.',          60, 2800, 40),
  ('lifting-pestanas',        'Lifting de pestañas',     'Mirada',              'Curvatura y definición natural de tus pestañas.', 60, 3500, 50),
  ('tinte-cejas',             'Tinte de cejas',          'Mirada',              NULL,                                              20,  800, 60),
  ('microblading',            'Microblading de cejas',   'Mirada',              'Incluye diseño personalizado.',                  120, 25000, 70),
  ('hilo-cejas',              'Cejas con hilo',          'Depilación',          NULL,                                              15,  600, 80),
  ('hilo-cara',               'Cara completa con hilo',  'Depilación',          NULL,                                              30, 1500, 90),
  ('laser-pequena',           'Láser · zona pequeña',    'Depilación',          'Labio, axilas, ingles...',                        15, 2500, 100),
  ('laser-mediana',           'Láser · zona mediana',    'Depilación',          'Medias piernas, brazos...',                       30, 4500, 110),
  ('laser-piernas',           'Láser · piernas completas','Depilación',         NULL,                                              60, 8000, 120);

-- Lunes a viernes 10:00-20:00 (pausa 14:00-16:00), sábado mañana, domingo cerrado
INSERT INTO business_hours (weekday, closed, open_time, close_time, break_start, break_end) VALUES
  (0, true,  NULL,    NULL,    NULL,    NULL),
  (1, false, '10:00', '20:00', '14:00', '16:00'),
  (2, false, '10:00', '20:00', '14:00', '16:00'),
  (3, false, '10:00', '20:00', '14:00', '16:00'),
  (4, false, '10:00', '20:00', '14:00', '16:00'),
  (5, false, '10:00', '20:00', '14:00', '16:00'),
  (6, false, '10:00', '14:00', NULL,    NULL);
