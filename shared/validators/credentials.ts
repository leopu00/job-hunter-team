/**
 * Validatori credenziali — Zod schemas
 *
 * Schema per ApiKeyCredential, OAuthCredential (discriminated union),
 * EncryptedPayload, e input operazioni CRUD.
 */

import { z } from "zod";
import {
  nonEmptyString,
  hexString,
  timestampMs,
  optionalTimestamp,
  enumFromValues,
  validate,
  type ValidationResult,
} from "./common.js";

// ── Enum provider ──────────────────────────────────────────────────────────

const API_KEY_PROVIDERS = ["claude", "openai", "minimax"] as const;
const OAUTH_PROVIDERS = ["chatgpt_pro", "claude_max"] as const;
const ALL_PROVIDERS = [...API_KEY_PROVIDERS, ...OAUTH_PROVIDERS] as const;

export const ApiKeyProviderSchema = enumFromValues(API_KEY_PROVIDERS, "Provider API key non valido");
export const OAuthProviderSchema = enumFromValues(OAUTH_PROVIDERS, "Provider OAuth non valido");
export const ProviderSchema = enumFromValues(ALL_PROVIDERS, "Provider non valido");

export const CredentialSourceSchema = enumFromValues(
  ["env", "file", "config", "none"] as const,
);
export const CredentialPrecedenceSchema = enumFromValues(
  ["env-first", "file-first"] as const,
);

// ── Credenziali ────────────────────────────────────────────────────────────

export const ApiKeyCredentialSchema = z.object({
  type: z.literal("api_key"),
  provider: ApiKeyProviderSchema,
  apiKey: nonEmptyString,
  savedAt: timestampMs,
});

export const OAuthCredentialSchema = z.object({
  type: z.literal("oauth"),
  provider: OAuthProviderSchema,
  accessToken: nonEmptyString,
  refreshToken: z.string().trim().optional(),
  expiresAt: optionalTimestamp,
  savedAt: timestampMs,
});

export const CredentialSchema = z.discriminatedUnion("type", [
  ApiKeyCredentialSchema,
  OAuthCredentialSchema,
]);

// ── Encrypted payload ──────────────────────────────────────────────────────

export const EncryptedPayloadSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  iv: hexString,
  authTag: hexString,
  data: hexString,
});

// ── Input operazioni ───────────────────────────────────────────────────────

export const SaveApiKeyInput = z.object({
  provider: ApiKeyProviderSchema,
  apiKey: nonEmptyString,
});

export const SaveOAuthTokenInput = z.object({
  provider: OAuthProviderSchema,
  accessToken: nonEmptyString,
  refreshToken: z.string().trim().optional(),
  expiresAt: optionalTimestamp,
});

export const ResolveCredentialInput = z.object({
  provider: ProviderSchema,
  precedence: CredentialPrecedenceSchema.default("env-first"),
});

// ── Funzioni di validazione ────────────────────────────────────────────────

export function validateCredential(data: unknown): ValidationResult<z.infer<typeof CredentialSchema>> {
  return validate(CredentialSchema, data);
}

export function validateEncryptedPayload(data: unknown): ValidationResult<z.infer<typeof EncryptedPayloadSchema>> {
  return validate(EncryptedPayloadSchema, data);
}

export function validateSaveApiKey(data: unknown): ValidationResult<z.infer<typeof SaveApiKeyInput>> {
  return validate(SaveApiKeyInput, data);
}

export function validateSaveOAuthToken(data: unknown): ValidationResult<z.infer<typeof SaveOAuthTokenInput>> {
  return validate(SaveOAuthTokenInput, data);
}

export function isValidProvider(value: string): boolean {
  return ProviderSchema.safeParse(value).success;
}

export function isValidApiKeyProvider(value: string): boolean {
  return ApiKeyProviderSchema.safeParse(value).success;
}
