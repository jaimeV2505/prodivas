# Pro Diva Melide · Sistema de reservas

Web + reservas online para el centro de estética Pro Diva (Melide).
Next.js 15 · React 19 · TypeScript · PostgreSQL · Framer Motion · Docker (local) · Vercel (producción).

## Novedades: blindaje, embudo medible y crecimiento

> **Verlo en local:** `docker compose up db -d` · `npm install` · `cp .env.example .env` (pon `SESSION_SECRET`, `ADMIN_PASSWORD`, `DEMO_MODE=on`) · `npm run db:migrate` · `npm run dev` · opcional `npm run demo:seed` (datos ficticios para ver el panel vivo; `npm run demo:clear` los borra) y `npm run cron` en otra terminal. Con `DEMO_MODE=on` y sin Twilio/WhatsApp, los mensajes no salen: se ven en **/admin/bandeja** («Mensajes») y el código de verificación aparece en pantalla.

**Blindaje**
- **Teléfono verificado con código** (`PHONE_VERIFY=off|new|all`, por defecto `new`): solo a números nuevos; quien ya vino o ya verificó no lo ve nunca. Frena reservas falsas y SMS a números ajenos. Sin canal para mandar el código (ni Twilio ni WhatsApp) queda desactivado salvo en `DEMO_MODE`.
- **Frenos de peticiones** en Postgres (vale en Vercel): bloqueos por conexión, 12 confirmaciones/hora y **4 teléfonos distintos/día por conexión**, 8 reservas/día por teléfono, límites en disponibilidad, lista de espera, «mis citas» y respuestas. Para pruebas automáticas: `DISABLE_RATE_LIMITS=1` (ignorado en producción real).
- **Panel**: login con tope de intentos (6 fallos/15 min por conexión), sesión de 3 días, **«Cerrar sesión en todos los dispositivos»** (Ajustes → Seguridad), registro de cambios (`audit_log`, últimos en Ajustes).
- `SESSION_SECRET` es **obligatorio en producción** (antes los enlaces firmados caían a un secreto fijo). Cabeceras de seguridad + CSP (`next.config.mjs`).
- Un bloqueo caducado ya no da falsos «hueco ocupado» (se limpia antes de escribir una hora y en cada ciclo del cron), y confirmar re-valida cierres/vacaciones. Una ficha verificada o con visitas no se pisa al reservar con su teléfono.
- **RGPD**: `/privacidad`, `/aviso-legal`, `/cookies` (completa tus datos en `src/lib/legal.ts` y que los revise tu gestor), aviso de consentimiento (sin cookies de terceros) y **retención automática**: fichas sin actividad 3 años → anonimizadas; contactos sin reservar 90 días; registros de mensajes 12 meses.

**Embudo medible** (`/admin/panel`)
- Cada paso anónimo (entra → elige servicio → ve huecos → bloquea → rellena → deja teléfono → reserva) con % de caída y «aquí pierdes más gente», por origen (UTM / referrer), dispositivo, servicio, mapa de horas flojas, retención y dormidas. La conversión («reservada») la apunta el **servidor**, no el navegador. Sin consentimiento nada se guarda en el dispositivo.
- **Recuperación de reservas a medias**: al escribir un teléfono válido con el hueco bloqueado se guarda el contacto; si no termina, a los 25 min–24 h se le escribe **una sola vez** con un enlace que reabre su servicio y su día (`WA_TEMPLATE_ABANDON` para WhatsApp; si no, SMS/email). Se desactiva en Ajustes.
- **«Vino» automático**: 3 h después de una cita sin marcar cuenta como que vino (la dueña corrige solo las que no; se le avisa). Así no se corta nunca el «gracias» + cuidados + valoración + retoque + sellos.
- La lista de espera **vuelve a activar** a quien fue avisado y no reservó (3 h).

**Crecimiento**
- **Trae a una amiga**: cada clienta tiene enlace propio (`/reservar?ref=CÓDIGO`) y botón de WhatsApp en su cita; cuando la amiga viene por primera vez las dos ganan el premio (se canjea desde la ficha). Premio editable en Ajustes.
- **«Te echamos de menos»** (`WA_TEMPLATE_REACTIVATE`): a las clientas que llevan N días sin venir (75 por defecto; 0 = apagado), con su último servicio y baja; una vez cada 4 meses.
- **SEO local**: `sitemap.xml`, `robots.txt`, JSON-LD de negocio y páginas por servicio (`/servicios/<slug>`) con CTA directo a reservar.
- **Valoraciones sin filtro**: a todas se les ofrece dejarla en Google (Google desaconseja filtrar solo las buenas); las bajas además avisan al momento a la dueña.
- **Prefill** de nombre y teléfono en este móvil para quien ya reservó.

**Habilidades, reparto, pose y recursos** (diseño en `docs/DISENO-FASES-Y-RECURSOS.md`)
- **Habilidades:** Ajustes → Profesionales → «Hace todos los servicios / solo…». Los huecos solo salen de quien puede hacer **todos** los servicios de la visita, y «sin preferencia» reparte por la que menos citas lleva ese día.
- **Tiempos de pose:** en cada servicio, «Fases» (`30 + 45e + 30`: la «e» es espera, la suma debe ser la duración). Mientras la clienta espera, la profesional queda **libre para otra clienta**; la clienta lo ve como «incluye 45 min de pose». Las fases actúan dentro del horario; la espera puede cruzar la pausa del mediodía.
- **Recursos compartidos:** Ajustes → Recursos (unidades exclusivas: «Cabina láser 1», «Lavacabezas 1/2»…) y, en el servicio, «Recurso necesario» + «toda la cita / solo mientras actúa». Dos profesionales no pueden usar a la vez la misma unidad, y sin unidades activas el servicio no ofrece huecos (aviso rojo en Ajustes).
- **Cómo funciona por dentro:** una cita pasa a tener **varios bloques** (`booking_blocks`) y el candado de Postgres vive ahí (uno por profesional y otro por unidad de recurso). Las citas simples siguen siendo un solo bloque que mantiene un trigger. `AVAILABILITY_SHADOW=on` compara cada cálculo de huecos con el método antiguo y anota cualquier diferencia en `audit_log` (se verificaron cientos de cálculos con cero diferencias). A una cita con pose o recurso no se le ofrece «añadir un servicio» desde el móvil.
- **Profesional habitual:** al venir, se guarda la más frecuente de sus últimas 5 visitas (ficha de la clienta); en este móvil la reserva ofrece «Con Laura, como siempre» y, si no hay huecos con ella, «Ver huecos con cualquier profesional»; los mensajes de retoque y «te echamos de menos» abren la reserva con su profesional (`?pro=`).
- *Pendiente:* precio y duración por largo de pelo («variantes de servicio»), y varios tipos de recurso por servicio desde el editor (el motor ya los admite).

**Cron** (imprescindible): `.github/workflows/reminders.yml` (secretos `CRON_SECRET` y `SITE_URL`), o `npm run cron` en local, o el servicio `cron` de `docker-compose.yml`. Cada ciclo: recordatorios, resúmenes, SMS de respaldo, post-visita, retoques, «vino» automático, recuperación, reactivación, limpieza de bloqueos y retención.

**Pruebas**: `npm run test:unit` (sin base de datos) · `npm run test:e2e` (suite original, 134 comprobaciones; la web debe estar arrancada con `PHONE_VERIFY=off DISABLE_RATE_LIMITS=1`) · `npm run test:growth` (18 comprobaciones de lo nuevo; con la web en su configuración normal) · `npm run test:phases` (22 comprobaciones de pose, recursos y bloques, con un modelo de referencia aparte; la web con `PHONE_VERIFY=off DISABLE_RATE_LIMITS=1`). CI en `.github/workflows/ci.yml`.

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

## Cómo se calculan los huecos

Todo sale de **tres datos que se editan en `/admin/ajustes`**: la duración de cada servicio, el horario (con pausa) y el modo de huecos. Cambiar cualquiera de ellos reajusta los huecos al instante; las citas ya reservadas conservan su hora y su duración.

1. **Tramos libres.** Para cada profesional y bloque de trabajo (antes y después de la pausa) se restan las citas confirmadas, los bloqueos en curso y el tiempo libre del salón.
2. **La cita ocupa exactamente la duración del servicio** y solo se ofrece un hueco si cabe entero en un tramo libre. Un servicio de 30 min ofrece huecos de 30; uno de 45, de 45; el de 120, de 2 horas. (Si quieres otro ritmo para un servicio, rellena "Hueco" en sus ajustes.)
3. **Modo de huecos** (ajustes → *Cómo se ofrecen los huecos*):
   - **Sin restos (recomendado, por defecto):** ofrece las horas redondas y también las **pegadas a otras citas**, pero **nunca un hueco que deje un resto libre más corto que tu servicio más corto** (ese resto no se podría vender). El "servicio más corto" se recalcula solo si añades o quitas servicios.
   - **Compacto:** solo horas pegadas al inicio o al final de un tramo libre. Día lo más seguido posible, con menos opciones.
   - **Libre:** rejilla fija por servicio, sin regla de restos.
4. **Al cancelar, el hueco se vuelve a ofrecer al instante**, y la cita **no desaparece**: sigue en la agenda con una etiqueta roja «✕ Cancelada» (por la clienta o por el centro), tachada y sin ocupar el hueco. Si prefieres no verlas, «ocultar».

Ejemplo (mañana de 10:00 a 14:00, ya hay una cita de 30 min a las 10:30, servicio de 45 min): *Libre* ofrece 11:30, 12:15, 13:00; *Sin restos* ofrece 11:00, 11:30, 11:45, 12:15, 12:30, 13:00, 13:15; *Compacto* ofrece 11:00, 11:45, 12:30, 13:15.

Contrapartida: ocultar un hueco que dejaría un resto inútil puede quitar alguna opción a la clienta. Si prefieres ofrecer todo, usa el modo *Libre*.

## Pruebas de reservas y cancelaciones

`scripts/e2e.mjs` comprueba contra una instancia real: que los huecos de cada servicio coinciden con un **modelo de referencia escrito aparte de la consulta SQL** (en el modo configurado), preaviso, bloquear → confirmar → cancelar → hueco libre otra vez, ningún solape entre servicios, carrera de seis personas sobre el mismo hueco, recordatorio programado y lista de espera.

```bash
docker compose up -d --build
DATABASE_URL=postgres://prodiva:prodiva@localhost:5433/prodiva BASE_URL=http://localhost:3100 npm run test:e2e
```
⚠️ Crea y cancela citas llamadas "E2E Test" en esa base de datos y las borra al terminar. Úsalo en local o en una base de datos de pruebas.

## Imágenes de la web

> **Ahora mismo la portada usa la animación y los dibujos** (la foto está desactivada hasta tener una de más calidad; `NEXT_PUBLIC_HERO_PHOTO=on` la activa). La imagen para compartir enlaces (`public/og.jpg`) está generada con los dibujos de la marca.

Las fotos están en `public/images/` y se registran en `src/lib/media.ts`:

| Archivo | Dónde se usa |
| --- | --- |
| `hero.jpg` | Portada: fondo en escritorio (≥ 1200 px) y banner en móvil/tablet |
| `hero-nails-mask.png` | Máscara de las cuatro uñas de la foto (transparencia): el selector «Pruébalo en tus uñas» pinta **las uñas reales** de la foto con capas de mezcla (color, y oscurecer/aclarar según el esmalte) |
| `nails.jpg` | Panel «Manicura y pedicura» (`STILLS.nails`) |
| `../og.jpg` | Vista previa al compartir el enlace (WhatsApp, Instagram…), 1200×630 |

- **Cambiar la foto del hero:** sustituye `public/images/hero.jpg` (misma composición: mano a la derecha, mitad izquierda vacía) y ejecuta `pip install pillow numpy scipy` y `python3 scripts/make-nail-mask.py --preview`. Debe decir «4 uñas detectadas»; revisa la vista previa. Con otra composición hay que ajustar las zonas del script.
- **Más fotos en los paneles:** guarda `public/images/eyes.jpg` o `wax.jpg` y añádelas a `STILLS` en `src/lib/media.ts`. Si además hay un vídeo en `public/videos/<nombre>.mp4`, el vídeo va encima.
- **Volver al fondo animado sin foto:** `NEXT_PUBLIC_HERO_PHOTO=off`.
- **Calidad:** la foto actual es una ampliación ×2 (suavizada y con grano fino) de un original de solo 1280 px, así que no tiene detalle real. Sustitúyela por una de 2560 px o más (idealmente 3840 px) y ejecuta el script de la máscara. Para exportar: JPG calidad ~84, progresivo, sin submuestreo de color; ~300–500 KB.
- Guía de prompts para generar el resto de imágenes: `docs/NANO-BANANA.md`.

## Hero: mini-reserva, "pruébalo en tus uñas" y titular suave

- **Agenda en vivo:** `/admin` se refresca sola cada 30 s; una cita cancelada sigue visible con etiqueta roja y su hueco vuelve a ofrecerse.
- **Botón Atrás:** en la reserva y en el modo fácil, el botón Atrás del móvil o del navegador vuelve al paso anterior en vez de salir de la página.
- **Mini-reserva:** elige servicio, ve los próximos huecos reales y pulsa uno: la reserva se abre con el hueco ya bloqueado y en el paso de datos. Si quedan pocos huecos esta semana (12 o menos) se muestra el número real; si hay muchos, no se muestra nada (nunca se inventa escasez).
- **Esmaltes:** el selector de esmaltes y la mano del héroe se han quitado (no aportaban a la reserva). `src/lib/polish.ts` queda sin uso en la portada.
- **Titular:** entra con un fundido suave (de borroso a nítido, subiendo un poco). Con el ratón, un brillo rosa muy suave se desliza por «Pro Diva,». En móvil y con «reducir movimiento» se queda quieto.
- Fondo: animación con pétalos (o `/videos/hero.mp4` si existe, o la foto con `NEXT_PUBLIC_HERO_PHOTO=on`). **Ya no hay mano ni selector de esmaltes** en el héroe: está pensado para que todo quepa en la primera pantalla (titular, mini-reserva con huecos en directo y el gancho «Pedir cita fácil»; en escritorio, a la derecha, con el contacto). Si activas la foto del héroe, el selector de color de uñas ya no existe y se ve tal cual.
- **Favicon:** `src/app/icon.png`, `apple-icon.png` y `favicon.ico` (la flor rosa sobre magenta).
- **Diva (el avatar):** en la reserva, debajo de «Tu cita» (en móvil, una tarjeta al final). Reacciona al paso, **habla sola cada ~24 s** (tendencias y consejos según lo que has elegido), **contesta preguntas** (tendencias, precios, cuánto dura, dónde estáis…) y puede **añadir un servicio a tu cita con un toque**. No usa IA ni servicios externos: son reglas sencillas con los datos reales del salón (`src/lib/diva.ts`). Colores de piel y pelo en `.avatar` de `globals.css`.
- **Tendencias de Diva:** se editan en `/admin/ajustes → Tendencias del avatar` (texto, tema, servicio que ofrece, orden, activa). Vienen con 8 de ejemplo orientativas del otoño 2026 (burdeos, marrón chocolate, malva, verde oliva, micro french, uñas cortas, lifting, cejas naturales): **cámbialas cada temporada y deja solo lo que hacéis**.

## Fase 2: lo que ya está montado

| Qué | Cómo funciona |
| --- | --- |
| **Cambiar la hora** | La clienta lo hace desde su enlace (`/c/CÓDIGO` → *Cambiar la hora*) hasta `RESCHEDULE_NOTICE_HOURS` (12 h) antes; su propio hueco cuenta como libre. Desde `/admin/cita/…` la dueña puede poner cualquier hora (solo se impide solapar). Se reinicia el recordatorio, se avisa a la clienta y el hueco antiguo se ofrece a la lista de espera. |
| **Semana** | `/admin/semana`: calendario de 7 días con citas (verde = confirmada, rojo = no vino, gris = ya vino), pausas, bloqueos y cierres. Se refresca sola. |
| **Llegó / no vino** | Botones en la agenda y en la ficha de la cita. «No vino» suma un plantón a la clienta y retiene la señal; se puede deshacer. |
| **Ficha de clienta** | `/admin/clientas`: se crea sola con cada reserva (una por teléfono), con historial, visitas, plantones y notas privadas. Con `NO_SHOW_ALERT` plantones (2), te avisa por Telegram cuando reserva. |
| **Varios servicios** | En el paso «Elige tu hueco», *Añadir otro servicio a la misma visita* (hasta 4): se suman duraciones y precios, y se reserva un solo bloque con la misma profesional. Cada servicio guarda su precio y duración del momento. El modo fácil (`/cita`) sigue con un servicio para no complicar. |
| **Limpieza entre citas** | En Ajustes → Servicios, «Limpieza (min)»: se bloquea después de la cita (la clienta no la ve) y el candado de la base de datos la respeta. |
| **Horarios por profesional** | Ajustes → Profesionales: añadir, desactivar y darles horario propio. Vacaciones: *Bloquear horario* eligiendo a la profesional. |
| **Señal (depósito)** | Ajustes → Servicios → «Señal (€)». Se cobra con Stripe Checkout al reservar (el hueco se mantiene ~35 min mientras paga) y se descuenta del total. **Política:** si cancela con `DEPOSIT_REFUND_HOURS` (24) h o más se devuelve; si no, se retiene; si cancela el centro, siempre se devuelve; si no vino, se retiene. Si pagó pero su hueco se ocupó, se le devuelve el dinero y te avisamos. **Solo se activa si hay claves de Stripe.** |
| **Mensaje entregado** | WhatsApp: se guarda cada estado (enviado → entregado → leído) por el webhook de Meta; si falla, SMS al instante; si a los 15 min sigue sin constar como entregado, SMS de respaldo (o aviso a la dueña si no hay SMS). SMS: Twilio avisa de si llegó. La ficha de cada cita muestra el estado de cada mensaje. |
| **Resumen diario** | Cada día a partir de `SUMMARY_TIME` (08:30), por Telegram/email: citas de hoy, cuántas sin confirmar, huecos libres, lista de espera y llamadas pendientes. No se envía los días cerrados. |
| **Calendario en el móvil** | Ajustes → *Calendario en tu móvil*: dirección secreta `.ics` para suscribirse desde Apple, Google u Outlook. |
| **Estado de la configuración** | Ajustes: lista con ✓/✗ de cada canal, cuándo se ejecutó por última vez el cron, y botones para enviar mensajes de prueba. |

Configuración de cuentas (Telegram, Twilio, Resend, Meta, Stripe, GitHub): **`docs/SETUP.md`**.

## Reserva completa: packs, extras, acompañante, atajos, retoque y señal inteligente

Todo se gestiona en `/admin/ajustes` (no hace falta tocar código):

- **Packs:** combinaciones ya organizadas («Manos y pies», «Mirada completa», «Express») que la clienta ve al principio de la reserva y que Diva recomienda. El descuento (0–90 %) se aplica solo si elige **exactamente** esos servicios; el servidor lo comprueba y guarda el precio ya rebajado. **Los de ejemplo vienen sin descuento: ponlo tú si quieres.** Al elegir un servicio se sugiere lo que combina o completa un pack.
- **Extras que suman tiempo:** retirada de esmalte, nail art… suman duración y precio y se tienen en cuenta al calcular los huecos y al cambiar la hora. Si eliges una categoría, solo se ofrecen con servicios de esa categoría.
- **«Venimos 2»:** la acompañante añade sus servicios al mismo bloque (el mismo servicio puede repetirse); su nombre llega al salón en los comentarios. Hasta 6 servicios en un bloque (4 si van en horas distintas).
- **Atajos:** «lo antes posible», «esta tarde» y «como siempre» (día y hora habituales según las visitas anteriores **guardadas en ese móvil**), y «repetir lo de la última vez».
- **Retoque automático:** cada servicio puede llevar «retoque (semanas)». Al confirmar, se propone el mismo día de la semana y hora N semanas después (calculado en hora local: no se descuadra con el cambio de hora) y se reserva con un toque; si no hay hueco, ofrece los más cercanos.
- **Señal inteligente:** «Según el servicio» (como siempre) o «Solo a quien ya ha faltado» (con N plantones y un importe por defecto si el servicio no lleva señal; los servicios marcados «Señal siempre» la piden a todas). A la clienta nunca se le enseña su historial: solo se le avisa de que, si ha faltado antes, se le pedirá una señal. Solo actúa con Stripe activo.
- **Casillas de seguridad (láser, microblading):** el servicio lleva «casillas de seguridad» y la reserva (también el modo fácil) no se confirma sin marcarlas. **Solo se guarda que las marcó y cuándo, nunca datos de salud.** Los textos están en `src/lib/i18n/es.ts` (`laser1…`, `microblading1…`): **revísalos con tu gestor.**
- **Migración:** esta versión usa columnas y tablas nuevas. En Vercel (`vercel-build`) y en Docker se aplica sola al desplegar; si lo haces a mano, `npm run db:migrate`. Sin la migración, reservar fallaría (la pantalla de reservar tiene un respaldo, pero no el motor).

Pruebas: `npm run test:unit` (pruebas de la lógica: mensajes, horas de silencio, baja firmada, packs, Diva, «como siempre», señal inteligente, alternativas de cancelación; no necesita base de datos) · `npm run audit:mobile` (navegador: 19 pantallas y 118 comprobaciones; falla si alguna pantalla tiene avisos) · `npm run test:e2e` (con base de datos real: extras, pack con descuento, casillas, tope de citas, cancelaciones, notificaciones, packs para dos, añadir servicios, grupos…; **sin ejecutar desde aquí**).

## Cancelaciones

- **Rescate:** al pulsar «No puedo ir» se ofrecen primero **3 huecos reales** parecidos a su cita (misma duración, extras incluidos, días distintos si es posible) y un toque la mueve. Si prefiere cancelar, sigue el flujo.
- **Motivo en un toque** (enfermedad, trabajo o familia, otro; opcional): se guarda y se incluye en el aviso a la dueña.
- **Cancelar tarde siempre se permite** (el hueco se libera para otra persona): se anota como «tarde», se le explica qué pasa con la señal (casilla obligatoria si va a perderla) y se le ofrece **ceder la cita** a otra persona (recibe su confirmación y su propio enlace; el enlace anterior deja de valer; la señal se queda con la cita).
- **Plazo por servicio:** en Ajustes, «Cancelar con (horas)» en cada servicio (vacío = la regla general, `CANCEL_NOTICE_HOURS`). Mismo plazo para la devolución de la señal. Láser y microblading arrancan en 48 h (solo la primera vez que se migra; luego lo cambias tú).
- **Cancelar todas** las citas que quedan de una visita en horas distintas, con un botón.
- **Cerrar el día** (agenda → «🚨 Cerrar este día»): bloquea el día entero y deja sus citas «por mover». A cada clienta le llega un mensaje (SMS y email; WhatsApp si defines `WA_TEMPLATE_CLOSED`) con un enlace donde elige otra hora —con 3 propuestas— o cancela **sin coste** (si pagó señal, se le devuelve). Esas citas pueden cambiarse sin plazo. Las que no contesten salen en la agenda como «Por mover» para llamarlas.
- Pendiente: cancelar solo a la acompañante (acortar el bloque).

## Notificaciones

- **Todo en castellano:** confirmación, recordatorios, cambios, cancelaciones, lista de espera, después de la visita y respuestas de WhatsApp. Por WhatsApp se usan tus plantillas aprobadas en Meta (`WA_TEMPLATE_*`); si falta alguna, ese mensaje sale por SMS y email.
- **Recordatorio en dos pasos:** (1) la **víspera a las 19:00** (`REMINDER_EVENING_HOUR`) —«mañana a las 10:00, ¿vienes?» con un toque—, solo si reservó antes de esa hora y aún no confirmó; (2) unas horas antes (`REMINDER_HOURS_BEFORE`), **solo a quien no confirmó** y con el texto «seguimos sin saber si vienes» si la víspera no contestó; (3) una hora después, si sigue sin responder, **aviso a la dueña** para que la llame. Al cambiar la hora o ceder la cita, el ciclo vuelve a empezar.
- **Horas de silencio:** no se envían recordatorios entre `QUIET_START` y `QUIET_END` (22:00–08:00 por defecto; hora del salón). Los mensajes opcionales solo salen de `OPTIONAL_FROM` a `OPTIONAL_TO` (10:00–20:00).
- **Después de la visita** (cuando la dueña marca «Vino»), 2 h después de acabar: **gracias + cuidados posteriores + «¿qué tal ha ido?»**. Los cuidados se escriben por servicio en Ajustes («Cuidados posteriores»; los de ejemplo **revísalos tú**, sobre todo los de láser y microblading). La valoración es **privada primero**: 1–3 estrellas piden qué mejorar (solo lo lee la dueña, que recibe un aviso al momento y puede llamar); 4–5 invitan a dejarla en Google (`GOOGLE_REVIEW_URL`). Todo se ve en `/admin/valoraciones` («Opiniones»).
- **«Toca retoque»:** una semana antes de que se cumplan las semanas del servicio (campo «Retoque (semanas)»), si la clienta no tiene ya otra cita.
- **Baja:** los dos mensajes anteriores son **opcionales**: llevan un enlace de baja firmado (se confirma con un botón) y la clienta también puede responder **BAJA** / **STOP** por WhatsApp. Los avisos de la cita (confirmación, recordatorios, cambios, cancelaciones) **no se pueden desactivar**. Por SMS los mensajes opcionales **no salen** salvo que pongas `OPTIONAL_SMS=on` (cuestan dinero); por WhatsApp necesitan su plantilla (`WA_TEMPLATE_AFTERCARE`, `WA_TEMPLATE_RETOQUE`) y por email salen siempre. Revisa con tu gestor que el texto cumple la normativa de comunicaciones comerciales.
- **Resumen de mañana a las 18:00** (`TOMORROW_SUMMARY_TIME`) para la dueña, con citas, huecos libres y lista de espera, y un enlace a **/admin/ofrecer**: un botón avisa a la lista de espera de los huecos de ese día (por orden de llegada y solo a quien le cabe su servicio).
- **Entrega visible:** la agenda marca «Sin aviso · llámala» cuando ninguna confirmación llegó a la clienta, y el detalle de la cita lo explica con un botón de llamar.
- Pendiente: canal preferido de la clienta.

## Packs y recomendaciones

- **Packs** (Ajustes → Packs): además de nombre, servicios y descuento, ahora tienen **ocasión** (etiqueta: «Boda», «Camino»…), **personas** (1 o **2 = «para dos»**: los servicios se hacen dos veces, para ella y su acompañante, que se apunta con su nombre), **temporada** (desde / hasta: fuera de fechas ni se ofrece ni aplica el descuento) y **⭐ destacado** (el «pack del mes», siempre el primero). El servidor comprueba que los servicios son exactamente los del pack (contando repeticiones) y que está en temporada. Vienen dos de ejemplo («Madre e hija» e «Invitada de boda»), sin descuento: ponlo tú.
- **Fidelidad (sellos)** (Ajustes → Fidelidad): cada visita a la que viene suma un sello; al completar la tarjeta (10 por defecto) hay un premio que **canjeas a mano** desde su ficha en «Clientas». La clienta ve su tarjeta en el enlace de su cita. Está **desactivado** hasta que lo actives.
- **Toca retoque** (en el móvil de la clienta, sin servidor): si ya han pasado casi las semanas de retoque de un servicio de su última visita y no tiene otra cita con él, al entrar se le propone reservarlo, recordando el color que eligió la última vez.
- **Test «¿qué manicura eres?»**: tres preguntas de un toque (tiempo, estilo, cuánto debe durar) y una recomendación lista para reservar (las atrevidas suman nail art si existe ese extra).
- **«¿Aprovechas y añades algo?»**: en el enlace de su cita (si faltan más de 12 h) se ofrecen los servicios que **caben justo a continuación**, comprobado con el motor de huecos (horario, descansos y otras citas). Se suma a la cita (duración y precio) y se avisa a la clienta y a la dueña. No se ofrecen servicios con señal ni con casillas de seguridad (esos se reservan aparte).
- **No hecho todavía:** «trae a una amiga, las dos ahorráis» (necesita códigos de invitación y descuento a dos), bonos y tarjetas regalo (pagos), y precios dinámicos de huecos tranquilos (es una decisión de negocio tuya).

## Pedir cita fácil (el gancho) y la app

- **Visible en la portada:** botón grande «Pedir cita fácil» en el héroe (con «3 toques · sin registrarte · instálala como app»), botón «Cita fácil» en la cabecera (en el móvil es el botón principal), barra fija inferior del móvil, y al final de la página junto a «Reserva completa».
- **Instalar la app, siempre:** cada vez que se entra a `/cita` desde el navegador sale **arriba** una franja «Ten la app en tu móvil — solo para pedir cita, con un toque». En Android/Chrome el botón **Instalar** abre el aviso del propio móvil; en iPhone explica «Compartir → Añadir a pantalla de inicio» (iOS no deja instalar con un botón); desde el navegador de **Instagram, Facebook o TikTok** (donde no se puede instalar) le dice que abra la página en su navegador. «Ahora no» solo la esconde en esa visita: la próxima vez que pida cita fácil, vuelve a salir. Con la app ya instalada y abierta, no sale. La app instalada abre directamente `/cita`, o sea, **solo el módulo de reservas**.
- **Packs y test en el modo fácil, sin recargar:** en «¿Qué te quieres hacer?» hay solo dos botones discretos, **🎁 Packs listos** y **🎀 Haz el test**. Los packs se piden como un servicio más (con su descuento); el test hace una pregunta por pantalla y termina en «Pedir esto». Los packs «para dos» y los extras se piden en la reserva completa, para no complicar el modo fácil. «Repetir mi cita» también recuerda los packs y las recomendaciones del test.

## Sin traducciones

Toda la web (reserva, Diva, servicios, mensajes y panel) está **solo en castellano**. Si ves en la base de datos columnas `lang` o `i18n` (en reservas, lista de espera, packs, extras y tendencias), son **herencia de una versión con gallego e inglés**: ya no se leen ni se escriben y no hacen daño; no hace falta tocarlas.

## Auditoría de visitas con varios servicios

Cómo funciona (y qué se corrigió):

- **Una visita = un solo bloque de tiempo:** suma de duraciones + limpieza del último servicio, con el paso de huecos más fino de los elegidos. El hueco se bloquea entero, así que nadie puede reservar encima de ninguna de sus partes.
- **«Me bloquea horas antes de la que elegí»:** eran las horas que se solapan con *tu propia* selección (una visita de 1 h 35 desde las 16:45 no cabe si empieza a las 16:00). El cálculo era correcto, pero dos cosas fallaban: aparecían como «ocupado por otra persona» y **no se podían pulsar** para mover la cita. Ahora, para ti, tu propio bloqueo no cuenta como ocupado (`/api/availability?holdId=…&holdToken=…`), las horas dentro de tu cita se marcan con borde discontinuo y la barra dice «Ocupa de 16:45 a 18:20».
- **Cambiar de hueco es atómico** (`replaceHoldId` en `/api/holds`): el hueco nuevo se bloquea y el anterior se libera en la misma transacción. Si el nuevo ya no está libre, **conservas el anterior** (antes se soltaba primero y podías quedarte sin ninguno).
- **Quitar servicios:** ahora se puede quitar cualquiera, incluido el primero, mientras quede al menos uno.
- **Lista de espera de visitas combinadas:** guarda todos los servicios y solo avisa cuando cabe la visita completa; el enlace del aviso reabre la reserva con todos ya elegidos.
- **Pruebas** (`npm run test:e2e`, contra una base de datos real): la visita combinada coincide con un modelo de referencia escrito aparte (pares y tríos, 5 días); todo hueco que se ofrece se puede reservar (muestra repartida); el bloqueo propio no cierra huecos; el cambio de hueco es atómico; la lista de espera guarda la visita completa.
- **Aún no probado contra la base de datos real desde aquí:** ejecuta `npm run test:e2e` tras desplegar.

## Reservas: visita seguida o cada servicio a su hora

- **Todo seguido (por defecto):** los servicios van en un solo bloque, con la misma profesional. Al elegir hora, **se bloquea el tramo entero de golpe** y en pantalla se ve como un bloque rosa con candado (las horas que empiezan dentro de él se marcan; pulsar una mueve la cita).
- **Cada uno a su hora** (con 2 o más servicios, justo encima del calendario): una cita por servicio, cada una con **su propio día y hora** (p. ej. uñas hoy y cejas el jueves). Se eligen una tras otra; al guardar una, pasa sola a la siguiente. Las horas que coinciden con otra cita suya se marcan (rayado) y no se pueden pulsar. Todos los bloqueos caducan a la vez (al guardar uno, el servidor alarga los demás) y se confirman **de una vez o ninguna** (`POST /api/bookings/batch`). Un solo aviso a la clienta y a la dueña con todas las citas; cada cita se puede cancelar o cambiar por separado.
- **Señal en varias citas:** se paga **una vez por el total**; el webhook confirma todo el grupo. Si al pagar una hora ya se había ocupado, se devuelve solo la parte de esa cita (reembolso parcial) y se avisa a la dueña.
- **Reglas por clienta (servidor):** no puede tener **dos citas solapadas** (aunque sean con profesionales distintas), ni al reservar ni al cambiar la hora; y hay un **tope de citas futuras por teléfono** (`MAX_ACTIVE_BOOKINGS`, 6 por defecto) para que nadie acapare huecos.
- **Si falla algo:** una hora ocupada o caducada deshace todo el grupo (nada queda a medias); doble clic o reintento devuelve las mismas citas sin duplicar; el tope de bloqueos por IP no libera las citas hermanas.
- **Pruebas** (`npm run test:e2e`): grupo confirmado de una vez, mismo grupo y ficha, repetir no duplica, cancelar una no cancela la otra, 4 bloqueos desde la misma IP siguen vivos y la misma clienta no puede reservar a la misma hora con otra profesional. **Sin ejecutar contra la base de datos real desde aquí.**

## Varias citas, «Tus citas» y volver atrás

- **Una clienta puede tener varias citas a la vez** (el sistema solo impide solapar horas de la misma profesional). Todas cuelgan de su ficha (un teléfono = una ficha).
- **Tus citas:** al abrir la app (`/cita`) se ven las próximas citas (2 y «Ver las N citas»), las acciones (*Repetir*, *Pedir cita*) y debajo las **canceladas con etiqueta roja**. La página de cada cita (`/c/…`) enseña además «Tus otras citas».
- **Pantalla de confirmación:** tiene **← Volver al menú**, *Reservar otra cita* (conserva nombre y teléfono) y *Ver mis citas*. El botón Atrás del móvil hace lo mismo.
- **Cada paso nuevo se ve desde arriba** (la pantalla vuelve al principio al cambiar de paso).

## Auditoría móvil (repetible)

`npm run audit:mobile` renderiza las pantallas reales (portada, reserva, modo fácil, citas y todo el panel) con datos de ejemplo y las mide en Chromium con tamaño de móvil (320, 360, 375 y 430 px), y recorre los flujos paso a paso (servicio → fecha → hueco bloqueado → datos → confirmación; modo fácil completo; hero; cambio de hora; lista de espera).
Comprueba: la página no se ensancha por los lados, objetivos táctiles ≥ 44 px (calendario ≥ 34 px de ancho en 320), letra ≥ 12 px, campos ≥ 16 px (si no, iOS hace zoom), textos cortados y errores de JavaScript. Termina con error si hay avisos.
Necesita `npm i` (ya trae playwright, tsx y esbuild) y `npx playwright install chromium` la primera vez. Las capturas quedan en `.audit/shots`.
Limitación: usa una tipografía de sustitución algo más ancha que la real (conservadora) y datos de ejemplo; no sustituye una prueba en un móvil de verdad.

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
Recuerda tu nombre y tu última cita (botón **Repetir**), tiene **letra grande**, barra de progreso (*Paso 2 de 4*), calendario al terminar y **"Prefiero que me llamen"** (avisa a la dueña por Telegram y queda en `/admin`).
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
Reglas del salón (preaviso, días máximos, duración del bloqueo) en `.env`. El tamaño de los huecos sale de la duración de cada servicio (ver más abajo).

## Cómo funciona el bloqueo

1. `GET /api/availability` genera la parrilla (horario − pausa − bloqueos − citas) en una sola consulta SQL.
2. `POST /api/holds` crea una fila `HOLD` con caducidad. La restricción `bookings_no_overlap` impide solapes.
3. `POST /api/bookings` confirma (`HOLD → CONFIRMED`) con los datos de la clienta. Si el bloqueo caducó pero el hueco sigue libre, se recupera; si no, avisa.
4. Anti-abuso: máximo 3 bloqueos vivos por IP, campo trampa (honeypot) y validación en servidor.

## Limitaciones conocidas / siguientes pasos

- **Nada de lo externo está probado contra servicios reales** (Telegram, Twilio, Resend, Meta, Stripe): el código está escrito contra su documentación, pero hay que ejecutarlo con tus cuentas. Usa **Ajustes → Estado de la configuración → Probar…** y `docs/SETUP.md`.
- Los servicios no se asignan a profesionales concretas (todas pueden hacer todo) ni hay recursos compartidos (p. ej. una sola máquina de láser).
- Varios servicios por visita: en el modo fácil (`/cita`) se reserva un servicio cada vez.
- La señal es solo con tarjeta (Stripe Checkout); Bizum no está soportado.
- Las plantillas de WhatsApp las aprueba Meta y puede tardar; mientras tanto funcionan SMS y email.
- Vídeos y animaciones: la web trae 7 ranuras de vídeo (hero, 3 paneles de servicios, 3 reels) con fondo animado de respaldo. Ver `HIGGSFIELD.md`.
