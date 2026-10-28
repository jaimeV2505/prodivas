import { CONFIG } from "./config";

/**
 * Datos del titular que exige la LSSI y el RGPD. ⚠️ Complétalos con los reales ANTES de publicar
 * (razón social, NIF y domicilio fiscal) y pide a tu gestor que revise los textos legales.
 */
export const LEGAL = {
  titular: "COMPLETAR · razón social o nombre y apellidos del titular",
  nif: "COMPLETAR · NIF/CIF",
  domicilioFiscal: "COMPLETAR · domicilio fiscal (si es distinto del salón)",
  registro: "COMPLETAR · datos de inscripción en el Registro Mercantil, si procede",
  email: process.env.OWNER_EMAIL || "COMPLETAR · email de contacto",
  nombreComercial: CONFIG.salon.name,
  direccionSalon: CONFIG.salon.address,
  telefono: CONFIG.salon.phoneMobile,
  actualizado: "28 de octubre de 2026",
} as const;

/** Plazos de conservación (los mismos que aplica la limpieza automática). */
export const RETENCION = {
  fichas: "3 años desde la última visita; después se anonimizan",
  leads: "90 días si no llegan a reservar",
  mensajes: "12 meses",
} as const;

export const isPending = (s: string) => s.startsWith("COMPLETAR");
