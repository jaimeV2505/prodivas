/** Teléfono de contacto del salón: sale en los mensajes («llámanos al…»), en los enlaces de WhatsApp y recibe los avisos de la dueña por SMS. */
const SALON_PHONE = process.env.NEXT_PUBLIC_SALON_PHONE ?? process.env.SALON_PHONE ?? "+34 623 27 79 86";
const SALON_DIGITS = SALON_PHONE.replace(/\D/g, "");

export const CONFIG = {
  tz: process.env.SALON_TIMEZONE ?? "Europe/Madrid",
  minNoticeMin: Number(process.env.MIN_NOTICE_MIN ?? 120),
  maxDaysAhead: Number(process.env.MAX_DAYS_AHEAD ?? 60),
  holdMinutes: Number(process.env.HOLD_MINUTES ?? 10),
  cancelNoticeHours: Number(process.env.CANCEL_NOTICE_HOURS ?? 24),
  maxHoldsPerIp: 3,
  /** Citas futuras como máximo por teléfono (evita acaparar huecos). */
  maxActiveBookings: Number(process.env.MAX_ACTIVE_BOOKINGS ?? 6),
  salon: {
    name: "Pro Diva",
    city: "Melide",
    address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña",
    phoneFixed: "981 93 76 65",
    phoneMobile: SALON_PHONE.replace(/^\+?34\s*/, "").trim(),
    /** Con prefijo de país y sin «+», para wa.me */
    whatsapp: SALON_DIGITS,
    /** Formato internacional, para SMS y llamadas */
    phoneE164: `+${SALON_DIGITS}`,
    instagram: "pro_diva_melide",
  },
} as const;
