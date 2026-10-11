/**
 * Casillas de seguridad antes de ciertos tratamientos. Solo se guarda que la clienta las ha marcado (y cuándo);
 * NUNCA datos de salud. Los textos están en src/lib/i18n.ts (revísalos con tu gestor/asesoría).
 */
export const CONSENT_KINDS = ["laser", "microblading"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
export const isConsentKind = (k: string | null | undefined): k is ConsentKind => !!k && (CONSENT_KINDS as readonly string[]).includes(k);
