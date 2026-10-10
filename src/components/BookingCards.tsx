import { fmtLong } from "@/lib/format";
import StatusTag from "./StatusTag";

export type CardBooking = {
  code: string;
  token: string;
  status: string;
  attendance?: string | null;
  startsAt: string;
  serviceName: string;
  cancelReason?: string | null;
};

/** Lista de citas con su etiqueta de estado (las canceladas, en rojo). Sirve en servidor y en cliente. */
export default function BookingCards({ items, variant = "web" }: { items: CardBooking[]; variant?: "web" | "easy" }) {
  return (
    <ul className={`bk-list bk-list--${variant}`}>
      {items.map((b) => (
        <li key={b.code} className={`bk ${b.status === "CANCELLED" ? "bk--cancelled" : ""}`}>
          <div className="bk__main">
            <p className="bk__when">{fmtLong(b.startsAt)}</p>
            <p className="bk__svc">{b.serviceName}</p>
          </div>
          <StatusTag status={b.status} attendance={b.attendance} startsAt={b.startsAt} cancelReason={b.cancelReason} />
          <a className="bk__go" href={`/c/${b.code}?t=${b.token}`}>
            {b.status === "CANCELLED" ? "Ver" : "Ver o cambiar"}
          </a>
        </li>
      ))}
    </ul>
  );
}
