/** Etiqueta de estado de una cita. Las canceladas llevan etiqueta roja, para que se vean y no se confundan. */
export type TagInput = { status: string; attendance?: string | null; startsAt: string; cancelReason?: string | null };

export function statusLabel(b: TagInput, now = Date.now()): { text: string; tone: "cancel" | "ok" | "noshow" | "past" | "pending" } {
  if (b.status === "CANCELLED") {
    const why = b.cancelReason === "centre" ? "Cancelada por el centro" : b.cancelReason ? "Cancelada por la clienta" : "Cancelada";
    return { text: why, tone: "cancel" };
  }
  if (b.attendance === "NO_SHOW") return { text: "No vino", tone: "noshow" };
  if (b.attendance === "SHOWED") return { text: "Vino", tone: "past" };
  if (new Date(b.startsAt).getTime() < now) return { text: "Pasada", tone: "past" };
  if (b.status === "CONFIRMED") return { text: "Confirmada", tone: "ok" };
  return { text: "Pendiente", tone: "pending" };
}

export default function StatusTag(props: TagInput) {
  const t = statusLabel(props);
  return <span className={`tag tag--${t.tone}`}>{t.tone === "cancel" ? "✕ " : ""}{t.text}</span>;
}
