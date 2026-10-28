export type ErrCode = "SLOT_TAKEN" | "HOLD_EXPIRED" | "NOT_FOUND" | "TOO_LATE" | "INVALID" | "CONFLICT" | "LIMIT" | "VERIFY";

export class BookingError extends Error {
  code: ErrCode;
  status: number;
  /** Datos extra para la pantalla (p. ej. el código de verificación en desarrollo). Nunca secretos en producción. */
  data?: Record<string, unknown>;
  constructor(code: ErrCode, message: string, status = 400, data?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}
