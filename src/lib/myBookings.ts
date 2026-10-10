/** Citas reservadas desde este móvil (código + token), para «Tus citas». Solo se usa en el navegador. */
const KEY = "pd_bookings";
export type SavedRef = { code: string; token: string };

export function loadSaved(): SavedRef[] {
  try {
    const raw = localStorage.getItem(KEY);
    let arr: SavedRef[] = raw ? (JSON.parse(raw) as SavedRef[]) : [];
    // Migración: antes solo se guardaba la última cita
    const last = localStorage.getItem("pd_last");
    if (last) {
      const l = JSON.parse(last) as { code?: string; token?: string };
      if (l?.code && l?.token && !arr.some((a) => a.code === l.code)) arr = [...arr, { code: l.code, token: l.token }];
      localStorage.removeItem("pd_last");
      localStorage.setItem(KEY, JSON.stringify(arr.slice(-20)));
    }
    return Array.isArray(arr) ? arr.slice(-20) : [];
  } catch {
    return [];
  }
}

export function saveBooking(code: string, token: string): void {
  try {
    const arr = loadSaved().filter((x) => x.code !== code);
    arr.push({ code, token });
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-20)));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}
