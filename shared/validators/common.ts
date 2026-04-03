/**
 * Validatori comuni riutilizzabili — Zod schemas base
 *
 * Stringhe, email, URL, timestamp, hex, ID.
 * Usati da tutti i moduli (config, credentials, tasks).
 */

import { z } from "zod";

// ── Stringhe ───────────────────────────────────────────────────────────────

/** Stringa non vuota (dopo trim) */
export const nonEmptyString = z.string().trim().min(1, "Campo obbligatorio");

/** Stringa opzionale — undefined se vuota dopo trim */
export const optionalString = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

/** Email valida */
export const emailSchema = z.string().trim().email("Email non valida");

/** URL valida */
export const urlSchema = z.string().trim().url("URL non valido");

/** URL opzionale */
export const optionalUrl = z.string().trim().url("URL non valido").optional();

// ── Numeri e timestamp ─────────────────────────────────────────────────────

/** Timestamp positivo (epoch ms) */
export const timestampMs = z.number().int().positive("Timestamp non valido");

/** Timestamp opzionale */
export const optionalTimestamp = z.number().int().positive().optional();

/** Intero positivo */
export const positiveInt = z.number().int().positive();

/** Intero non negativo */
export const nonNegativeInt = z.number().int().nonnegative();

// ── Hex e crypto ───────────────────────────────────────────────────────────

/** Stringa esadecimale (lunghezza pari) */
export const hexString = z
  .string()
  .regex(/^[0-9a-f]+$/i, "Deve essere una stringa hex")
  .refine((v) => v.length % 2 === 0, "Lunghezza hex deve essere pari");

/** UUID v4 */
export const uuid = z.string().uuid("UUID non valido");

// ── Enum helpers ───────────────────────────────────────────────────────────

/** Crea schema enum da array di valori */
export function enumFromValues<T extends string>(values: readonly [T, ...T[]], label?: string) {
  return z.enum(values, {
    errorMap: () => ({ message: label ?? `Valore non valido. Valori ammessi: ${values.join(", ")}` }),
  });
}

// ── Utility di validazione ─────────────────────────────────────────────────

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

/** Valida dati con schema Zod, ritorna risultato tipizzato */
export function validate<T>(schema: z.ZodType<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => {
      const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
      return `${path}${i.message}`;
    }),
  };
}

/** Valida e lancia errore se non valido */
export function validateOrThrow<T>(schema: z.ZodType<T>, data: unknown, label?: string): T {
  const result = validate(schema, data);
  if (result.success) return result.data;
  const prefix = label ? `${label}: ` : "";
  throw new Error(`${prefix}${result.errors.join("; ")}`);
}
