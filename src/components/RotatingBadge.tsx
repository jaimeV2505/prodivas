import { ArrowUpRight } from "lucide-react";
import TransitionLink from "./TransitionLink";

/** Sello circular que gira; lleva a la reserva. */
export default function RotatingBadge() {
  return (
    <TransitionLink href="/reservar" className="spin" aria-label="Reservar cita">
      <svg viewBox="0 0 200 200" className="spin__ring" aria-hidden="true">
        <defs>
          <path id="spin-circle" d="M100,100 m-76,0 a76,76 0 1,1 152,0 a76,76 0 1,1 -152,0" />
        </defs>
        <text className="spin__text">
          <textPath href="#spin-circle" textLength="472" lengthAdjust="spacing">
            Reserva online • Hueco bloqueado para ti • Sin llamar •
          </textPath>
        </text>
      </svg>
      <span className="spin__core"><ArrowUpRight size={30} aria-hidden="true" /></span>
    </TransitionLink>
  );
}
