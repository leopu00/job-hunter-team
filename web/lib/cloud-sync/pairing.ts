import { randomBytes } from "node:crypto";

/**
 * Helpers per device-flow pairing (CLI ↔ web).
 *
 * Pattern: OAuth 2.0 Device Authorization Grant (RFC 8628), adattato per
 * il cloud-sync di JHT. Genera coppia (device_code, user_code):
 *
 * - device_code: bearer-like, 32 char hex, usato dal CLI come identifier
 *   per il polling. Alta entropia (256 bit). Mai mostrato all'utente.
 * - user_code: 8 char in formato AAAA-1234 — 4 lettere uppercase
 *   (esclude I,O,L per leggibilita') + 4 cifre (esclude 0,1).
 *   Combinazioni: 23^4 * 8^4 ≈ 1,15 miliardi. Sufficiente per finestra
 *   10min con rate limit anti-brute.
 *
 * Esempio user_code: ABCD-1234
 */

const USER_CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ"; // skip I, O, L per evitare confusione con 1, 0
const USER_CODE_DIGITS = "23456789"; // skip 0, 1 per stessa ragione

export function generateDeviceCode(): string {
  return randomBytes(16).toString("hex"); // 32 char hex
}

export function generateUserCode(): string {
  const letters = pickRandomFrom(USER_CODE_LETTERS, 4);
  const digits = pickRandomFrom(USER_CODE_DIGITS, 4);
  return `${letters}-${digits}`;
}

function pickRandomFrom(alphabet: string, count: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < count) {
    for (const byte of randomBytes(Math.max(16, count * 2))) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === count) break;
    }
  }
  return out;
}

/**
 * Normalizza l'input dell'utente (lowercase, dashes opzionali, trim) in
 * formato canonico AAAA-1234. Restituisce null se invalido.
 *
 * Accetta:
 *   "abcd-1234" → "ABCD-1234"
 *   "ABCD1234"  → "ABCD-1234"
 *   "abcd 1234" → "ABCD-1234"
 *   " a b cd 12 34 " → "ABCD-1234"
 */
export function normalizeUserCode(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-_]/g, "").toUpperCase();
  if (cleaned.length !== 8) return null;
  const letters = cleaned.slice(0, 4);
  const digits = cleaned.slice(4);
  if (!/^[A-Z]{4}$/.test(letters)) return null;
  if (!/^\d{4}$/.test(digits)) return null;
  return `${letters}-${digits}`;
}

export interface PairingSession {
  device_code: string;
  user_code: string;
  status: "pending" | "approved" | "consumed" | "expired";
  user_id: string | null;
  approved_token: string | null;
  approved_token_id: string | null;
  approved_at: string | null;
  consumed_at: string | null;
  created_at: string;
  expires_at: string;
}

export const DEVICE_CODE_RE = /^[a-f0-9]{32}$/;
export const PAIRING_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const PAIRING_POLL_INTERVAL_SEC = 2;
