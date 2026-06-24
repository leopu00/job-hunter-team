/**
 * pii-crypto — cifratura a riposo dei dati di contatto (PII) del profilo.
 *
 * AES-256-GCM con chiave da env `JHT_PII_KEY` (32 byte, hex 64ch o base64).
 * Formato del valore cifrato: `enc:v1:<base64(iv|tag|ciphertext)>`.
 *
 * Transizione/robustezza:
 *  - se la chiave NON è configurata → encrypt restituisce il valore in chiaro
 *    (fallback) e decrypt lo ritorna invariato → nessun crash, attivazione
 *    quando la key viene impostata.
 *  - decrypt su valori NON prefissati (`enc:v1:`) li ritorna as-is (dati legacy
 *    scritti in chiaro prima dell'attivazione).
 *
 * Vedi docs/internal/candidate-profile-cloud-sync-redesign-2026-06-05.md §PII.
 */
import crypto from "node:crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.JHT_PII_KEY;
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, raw.length === 64 ? "hex" : "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function isPiiEncryptionEnabled(): boolean {
  return getKey() !== null;
}

export function encryptField(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return (plain ?? null) as string | null;
  if (plain.startsWith(PREFIX)) return plain; // già cifrato
  const key = getKey();
  if (!key) return plain; // fallback in chiaro finché la key non è configurata
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy/chiaro → invariato
  const key = getKey();
  if (!key) return value; // non decifrabile senza key → meglio raw che crash
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

type Contacts = Record<string, string | null | undefined>;

const CONTACT_FIELDS = [
  "email",
  "phone",
  "linkedin",
  "github",
  "website",
  "address",
] as const;

export function encryptContacts(
  c: Contacts | null | undefined,
): Contacts | null {
  if (!c) return null;
  const out: Contacts = {};
  for (const f of CONTACT_FIELDS) out[f] = encryptField(c[f]);
  return out;
}

export function decryptContacts(
  c: Contacts | null | undefined,
): Contacts | null {
  if (!c) return null;
  const out: Contacts = {};
  for (const f of CONTACT_FIELDS) out[f] = decryptField(c[f]);
  return out;
}
