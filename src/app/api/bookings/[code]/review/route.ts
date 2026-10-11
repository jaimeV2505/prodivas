import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { BookingError, getBookingByCode } from "@/lib/bookings";
import { query } from "@/lib/db";
import { respond } from "@/lib/http";
import { notifyOwnerReview } from "@/lib/notify";

export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().min(12),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(600).optional(),
  googleClicked: z.boolean().optional(),
});

/** La clienta valora su visita desde el enlace del mensaje (privado: lo lee la dueña). Una valoración por cita. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const b = Body.parse(await req.json());
    const booking = await getBookingByCode(z.string().min(4).max(16).parse(code).toUpperCase(), b.token);
    if (!booking || booking.status !== "CONFIRMED") throw new BookingError("NOT_FOUND", "No encontramos esa cita.", 404);
    if (new Date(booking.startsAt).getTime() > Date.now()) throw new BookingError("INVALID", "Todavía no ha pasado la cita.", 400);

    if (b.rating) {
      const ins = await query<{ id: number }>(
        `INSERT INTO reviews (booking_id, rating, comment) VALUES ($1::uuid, $2::int, $3)
         ON CONFLICT (booking_id) DO UPDATE SET rating = EXCLUDED.rating, comment = COALESCE(EXCLUDED.comment, reviews.comment)
         RETURNING id`,
        [booking.id, b.rating, b.comment || null],
      );
      // El comentario de las malas llega con el segundo envío: solo se avisa cuando hay algo que contar o la nota es mala
      after(() => notifyOwnerReview(booking, b.rating!, b.comment || null));
      return { saved: ins.length > 0 };
    }
    if (b.comment) {
      await query(`UPDATE reviews SET comment = $2 WHERE booking_id = $1::uuid`, [booking.id, b.comment]);
      const r = await query<{ rating: number }>(`SELECT rating FROM reviews WHERE booking_id = $1::uuid`, [booking.id]);
      if (r[0]) after(() => notifyOwnerReview(booking, r[0].rating, b.comment!));
      return { saved: true };
    }
    if (b.googleClicked) {
      await query(`UPDATE reviews SET google_clicked = true WHERE booking_id = $1::uuid`, [booking.id]);
      return { saved: true };
    }
    throw new BookingError("INVALID", "Falta la valoración.", 400);
  });
}
