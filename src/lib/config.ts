export const CONFIG = {
  tz: process.env.SALON_TIMEZONE ?? "Europe/Madrid",
  slotStepMin: Number(process.env.SLOT_STEP_MIN ?? 15),
  minNoticeMin: Number(process.env.MIN_NOTICE_MIN ?? 120),
  maxDaysAhead: Number(process.env.MAX_DAYS_AHEAD ?? 60),
  holdMinutes: Number(process.env.HOLD_MINUTES ?? 10),
  cancelNoticeHours: Number(process.env.CANCEL_NOTICE_HOURS ?? 24),
  maxHoldsPerIp: 3,
  salon: {
    name: "Pro Diva",
    city: "Melide",
    address: "Rúa Rambla San Pablo, 6, 15800 Melide, A Coruña",
    phoneFixed: "981 93 76 65",
    phoneMobile: "670 424 348",
    whatsapp: process.env.WHATSAPP_NUMBER ?? "34670424348",
    instagram: "pro_diva_melide",
  },
} as const;
