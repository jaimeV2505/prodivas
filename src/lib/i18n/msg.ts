/**
 * Textos de los mensajes que se envían a la clienta (WhatsApp, SMS y email).
 * Los de SMS van sin tildes especiales para no gastar más segmentos.
 */
export const msgEs = {
  whenToday: "hoy a las {time}",
  whenTomorrow: "mañana a las {time}",
  // confirmación
  createdSms: "Pro Diva: cita confirmada. {service}, {when}. Si no puedes venir, avisanos aqui: {link}",
  createdSubject: "Cita confirmada en {salon}",
  createdTitle: "¡Tu cita está confirmada!",
  createdHello: "Hola {name}, te esperamos:",
  createdNote: "La víspera te escribiremos para que confirmes con un toque que vienes.",
  createdButton: "Ver o cancelar mi cita",
  groupSms: "Pro Diva: {n} citas confirmadas. {lines}. Gestionalas aqui: {link}",
  groupSubject: "Tus {n} citas en {salon}",
  groupTitle: "¡Tus citas están confirmadas!",
  groupNote: "La víspera de cada cita te escribiremos para que confirmes que vienes.",
  groupButton: "Ver o cancelar mis citas",
  // recordatorios
  remSms: "Pro Diva: te esperamos {words} ({service}). Confirma o cancela con un toque: {link}",
  remSms2: "Pro Diva: seguimos sin saber si vienes {words} ({service}). Confirma o cancela aqui: {link}",
  remSubject: "¿Vienes {words}? · {salon}",
  remTitle: "¿Vienes {words}?",
  remBody: "Hola {name}, te recordamos tu cita de {service}.",
  remBody2: "Hola {name}, todavía no sabemos si vienes a tu cita de {service}.",
  remTip: "Si no puedes venir, cancela con un toque: así otra persona podrá aprovechar el hueco.",
  remYes: "Confirmo, voy",
  remNo: "No puedo ir",
  // cambios y cancelaciones
  reSms: "Pro Diva: tu cita ha cambiado a {when} ({service}). Si no te viene bien: {link}",
  reSubject: "Tu cita ha cambiado · {salon}",
  reTitle: "Tu cita ha cambiado de hora",
  reBody: "Tu cita de {service} es ahora:",
  reButton: "Ver o cambiar mi cita",
  closedSms: "Pro Diva: lo sentimos, tenemos que mover tu cita del {when}.{note} Elige otra hora o cancela sin coste aqui: {link}",
  closedSubject: "Tenemos que mover tu cita · {salon}",
  closedTitle: "Tenemos que mover tu cita",
  closedBody: "Hola {name}, lo sentimos mucho: tu cita de {service} ({when}) no puede ser.",
  closedBody2: "Elige otra hora con un toque, o cancela sin ningún coste (si pagaste señal, te la devolvemos).",
  closedButton: "Elegir otra hora",
  centreSms: "Pro Diva: tu cita del {when} ha sido cancelada. Llamanos al {phone} para darte otra. Disculpa las molestias.",
  centreSubject: "Tu cita ha sido cancelada · {salon}",
  centreTitle: "Tu cita ha sido cancelada",
  centreBody: "Tu cita de {service} ({when}) ha sido cancelada por el centro. Llámanos y te damos otra.",
  centreButton: "Reservar otra cita",
  // lista de espera
  wlSms: "Pro Diva: se ha liberado un hueco para {service}, {words}. Reservalo antes de que se ocupe: {link}",
  wlSubject: "Se ha liberado un hueco · {salon}",
  wlTitle: "¡Se ha liberado un hueco!",
  wlBody: "Hola {name}, ahora hay hueco para {service}: {words}.",
  wlNote: "Quien llegue primero se lo queda.",
  wlButton: "Reservar ahora",
  // después de la visita
  afterSms: "Pro Diva: gracias por venir, {name}. {care}Cuentanos que tal ha ido (10 segundos): {link}",
  afterSubject: "Gracias por venir · {salon}",
  afterTitle: "¡Gracias por venir!",
  afterBody: "Hola {name}, esperamos que te haya encantado tu {service}.",
  afterCareTitle: "Para que dure más",
  afterAsk: "¿Nos cuentas qué tal ha ido? Son 10 segundos.",
  afterButton: "Valorar mi visita",
  rtSms: "Pro Diva: hace casi {weeks} semanas de tu {service}, buen momento para el retoque. Reserva aqui: {link}",
  rtSubject: "Toca retoque de {service} · {salon}",
  rtTitle: "Toca retoque",
  rtBody: "Hola {name}, hace casi {weeks} semanas de tu {service}: es un buen momento para el retoque.",
  rtButton: "Reservar mi retoque",
  optoutLine: "Si no quieres más mensajes como este, entra aquí: {link}",
  optoutSms: "BAJA: {link}",
  // respuestas de WhatsApp
  replyConfirmed: "¡Perfecto! Te esperamos {words}. Gracias por confirmar.",
  replyCancelled: "Cita cancelada. Gracias por avisar. Cuando quieras otra, pídela en nuestra web o llámanos.",
  replyOptout: "Listo: no te escribiremos más con este tipo de mensajes. Los avisos de tus citas seguirán llegando.",
  // página de valoración
  revTitle: "¿Qué tal ha ido?",
  revSub: "Tu {service} del {when}. Pulsa las estrellas:",
  revStars: "{n} de 5",
  revGoodTitle: "¡Muchas gracias! 💖",
  revGoodBody: "Nos alegra mucho. ¿Nos ayudas con una reseña en Google? Tarda un minuto y ayuda a que más personas nos encuentren.",
  revGoogle: "Dejar mi reseña en Google",
  revBadTitle: "Gracias por decírnoslo",
  revBadBody: "Lamentamos que no haya sido perfecto. Cuéntanos qué podemos mejorar: solo lo leemos nosotras y te escribiremos si quieres.",
  revComment: "¿Qué podríamos mejorar?",
  revSend: "Enviar",
  revThanks: "Gracias. Lo hemos recibido y lo leeremos con cariño.",
  revAlready: "Ya nos dejaste tu valoración. ¡Gracias!",
  revError: "No hemos podido guardarlo. Inténtalo de nuevo.",
  // baja
  byeTitle: "No quiero más mensajes opcionales",
  byeBody: "Dejaremos de enviarte mensajes como los de «cómo ha ido» o «toca retoque». Los avisos de tus citas (confirmación, recordatorio, cambios) seguirán llegando.",
  byeButton: "Confirmar baja",
  byeDone: "Hecho. No te escribiremos más con ese tipo de mensajes.",
  byeError: "No hemos podido guardarlo. Inténtalo de nuevo o llámanos.",
} as const;

export type MsgDict = { [K in keyof typeof msgEs]: string };

/** Textos de los mensajes a la clienta (todos en castellano). */
export const msg: MsgDict = msgEs;
