# Configuración paso a paso

Orden recomendado: de lo más fácil a lo que lleva más trámites. Cada paso se puede comprobar en
**/admin/ajustes → Estado de la configuración** (✓/✗) y con los botones **Probar…**.

Número de pruebas usado en esta guía: **+46 79 325 06 92** (ya viene escrito en `NOTIFY_TEST_PHONE`).

> ⚠️ Si ese número es **tu WhatsApp personal**, no lo uses como número de la API de WhatsApp Business
> (la API necesita un número que no esté ya registrado en WhatsApp). Úsalo solo como **destinatario de pruebas**.

## 0. Variables obligatorias (Vercel → Settings → Environment Variables)

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | la de Neon (ya la tienes) |
| `ADMIN_PASSWORD` | una contraseña larga |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_SITE_URL` | `https://prodivas.vercel.app` (o tu dominio) |
| `SALON_PHONE` / `NEXT_PUBLIC_SALON_PHONE` | `+34 623 27 79 86` (teléfono de contacto: mensajes, enlaces wa.me y avisos de la dueña por SMS) |
| `NOTIFY_TEST_PHONE` | `+34623277986` |

Atajo: copia `.env.example` a `.env.production`, rellénalo y ejecuta `./scripts/vercel-env.sh`.

## 1. Telegram (aviso instantáneo a la dueña) · 5 min · gratis
1. En Telegram abre **@BotFather** → `/newbot` → pon un nombre → copia el **token** → `TELEGRAM_BOT_TOKEN`.
2. Abre tu bot y escríbele «hola».
3. Entra en `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia el número de `"chat":{"id":...}` → `TELEGRAM_CHAT_ID`.
4. Redeploy → Ajustes → **Probar Telegram**.

## 2. Recordatorios automáticos (GitHub) · 5 min · gratis
El workflow `.github/workflows/reminders.yml` llama cada ~10 min a `/api/cron/reminders` (recordatorios, recuperación de reservas, «vino» automático, limpieza…).
1. En GitHub → Settings → Secrets and variables → Actions deben existir `SITE_URL` (`https://prodivas.vercel.app`) y `CRON_SECRET`.
2. **El mismo valor de `CRON_SECRET` tiene que estar también en Vercel** (Settings → Environment Variables → Production). Atajo: `npx vercel login && npx vercel link` y `./scripts/vercel-env.sh .env.vercel` (el archivo `.env.vercel` lo genera el asistente y no se sube a git). Después, un *Redeploy*.
3. Pestaña **Actions → Recordatorios → Run workflow**. Debe responder `{"ok":true,...}`; si ves un aviso 401, el valor de Vercel no coincide.
4. En Ajustes aparecerá «Último ciclo de recordatorios: hace X min».

## 3. SMS con Twilio · 15 min · de pago por mensaje
1. Crea la cuenta en twilio.com. `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN` están en la consola.
2. **Cuenta de prueba:** solo envía a números verificados → Phone Numbers → *Verified Caller IDs* → añade **+34 623 27 79 86**.
3. Remitente: en España puedes usar un nombre (`TWILIO_FROM=ProDiva`) o comprar un número. Comprueba en Twilio las reglas de remitente para España.
4. Para clientas reales hace falta **actualizar la cuenta** (quitar el modo prueba).
5. Redeploy → Ajustes → pon el teléfono → **Probar SMS**.

## 4. Email con Resend · 10 min · gratis hasta cierto volumen
1. resend.com → crea la API key → `RESEND_API_KEY`.
2. Verifica tu dominio (necesario para que no caiga en spam) → `MAIL_FROM=Pro Diva <reservas@tudominio.com>`.
3. `OWNER_EMAIL` = tu correo. Ajustes → **Probar email**.

## 5. WhatsApp Business (Meta) · de 1 a varios días
1. developers.facebook.com → crea una app *Business* → añade el producto **WhatsApp**.
2. **API Setup:** copia `Phone number ID` → `WHATSAPP_PHONE_NUMBER_ID` y genera un token **permanente** (usuario del sistema) → `WHATSAPP_TOKEN`.
3. **Destinatarios de prueba:** añade **+34 623 27 79 86** (te llegará un código por WhatsApp).
4. Ajustes → **Probar WhatsApp** (usa la plantilla de ejemplo `hello_world`).
5. En *WhatsApp Manager → Plantillas*, crea (categoría **Utilidad**, idioma **Español**): `cita_confirmada`, `recordatorio_cita` y `hueco_libre`. Los textos exactos están en el README. La aprobación puede tardar.
6. **Webhook** (para los botones Confirmar/Cancelar y saber si el mensaje llegó): Callback URL `https://TU-DOMINIO/api/whatsapp/webhook`, verify token = el valor de `WHATSAPP_VERIFY_TOKEN` (invéntalo), suscríbete al campo **messages**. `WHATSAPP_APP_SECRET` = *App Secret* de la app (Settings → Basic).
7. Para clientas reales: verifica el negocio en Meta Business y registra el número definitivo.

## 6. Señal con tarjeta (Stripe) · 15 min
1. stripe.com → modo prueba primero. `STRIPE_SECRET_KEY` (`sk_test_…`).
2. Developers → Webhooks → *Add endpoint*: `https://TU-DOMINIO/api/stripe/webhook`, eventos `checkout.session.completed` y `checkout.session.expired` → copia el *Signing secret* → `STRIPE_WEBHOOK_SECRET`.
3. En Ajustes → Servicios pon la **señal** de microblading y láser. Reserva una cita de prueba con la tarjeta `4242 4242 4242 4242`.
4. Cuando todo funcione, cambia a las claves reales (`sk_live_…`) y crea el webhook también en modo real.

## 7. Calendario en tu móvil
Ajustes → **Calendario en tu móvil** → «Suscribirme». Las citas aparecen solas.

## Comprobación final
- Ajustes: todo en ✓.
- `npm run test:e2e` contra tu entorno local (ver README).
- Haz una reserva de verdad desde tu móvil y comprueba: confirmación, aviso en Telegram, recordatorio, cambio de hora y cancelación.
