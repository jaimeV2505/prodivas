export type ErrCode = "SLOT_TAKEN" | "HOLD_EXPIRED" | "NOT_FOUND" | "TOO_LATE" | "INVALID" | "CONFLICT" | "LIMIT";

export class BookingError extends Error {
  code: ErrCode;
  status: number;
  constructor(code: ErrCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
