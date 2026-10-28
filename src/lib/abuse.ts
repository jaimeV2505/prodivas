import { distinctLimit, limit } from "./ratelimit";
import { requirePhoneProof } from "./otp";
import { hashIp } from "./bookings";
import { clientIp } from "./http";
import { phoneDigits } from "./site";

/**
 * Puerta antes de confirmar una reserva (una o varias citas):
 *  - tope de confirmaciones por conexión y de teléfonos distintos por conexión y día (frena citas falsas y SMS a números ajenos);
 *  - tope por teléfono;
 *  - verificación del teléfono por código si hace falta (ver otp.ts).
 */
export async function guardConfirm(req: Request, phone: string, otp: string | undefined): Promise<string> {
  const ip = hashIp(clientIp(req));
  const k = phoneDigits(phone).slice(-9);
  await limit(`confirm-ip:${ip}`, 12, 3600, "Demasiadas reservas desde esta conexión. Llámanos y lo hacemos juntas.");
  await distinctLimit(`ipphone:${ip}`, k, 4, 86400, "Demasiados teléfonos distintos desde esta conexión. Llámanos y lo hacemos juntas.");
  await limit(`confirm-phone:${k}`, 8, 86400, "Este teléfono ya ha hecho muchas reservas hoy. Llámanos y lo vemos.");
  await requirePhoneProof(phone, otp, ip);
  return ip;
}
