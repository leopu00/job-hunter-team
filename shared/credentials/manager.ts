/**
 * Credential manager — CRUD API key e OAuth subscription.
 *
 * Risoluzione con precedenza: env var → file criptato → null.
 * Interfaccia unificata per il provider abstraction layer.
 */

import { deleteCredential, hasStoredCredential, listStoredProviders, readCredential, writeCredential } from "./storage.js";
import {
  API_KEY_PROVIDERS,
  ALL_PROVIDERS,
  ENV_VAR_MAP,
  OAUTH_PROVIDERS,
  type ApiKeyCredential,
  type ApiKeyProvider,
  type Credential,
  type CredentialPrecedence,
  type CredentialSource,
  type OAuthCredential,
  type OAuthProvider,
  type Provider,
  type ResolvedCredential,
} from "./types.js";

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvKey(provider: ApiKeyProvider): string | undefined {
  return trimToUndefined(process.env[ENV_VAR_MAP[provider]]);
}

// --- API Key ---

export function saveApiKey(provider: ApiKeyProvider, apiKey: string): void {
  if (!API_KEY_PROVIDERS.has(provider)) {
    throw new Error(`Provider non supportato: ${provider}`);
  }
  const key = apiKey.trim();
  if (!key) throw new Error("API key vuota");

  const credential: ApiKeyCredential = {
    type: "api_key",
    provider,
    apiKey: key,
    savedAt: Date.now(),
  };
  writeCredential(provider, credential);
}

export function resolveApiKey(
  provider: ApiKeyProvider,
  precedence: CredentialPrecedence = "env-first"
): ResolvedCredential | null {
  if (!API_KEY_PROVIDERS.has(provider)) {
    throw new Error(`Provider non supportato: ${provider}`);
  }

  const envKey = readEnvKey(provider);
  const fileCredential = readCredential(provider) as ApiKeyCredential | null;

  if (precedence === "env-first") {
    if (envKey) {
      return {
        credential: { type: "api_key", provider, apiKey: envKey, savedAt: 0 },
        source: "env",
      };
    }
    if (fileCredential?.type === "api_key") {
      return { credential: fileCredential, source: "file" };
    }
  } else {
    if (fileCredential?.type === "api_key") {
      return { credential: fileCredential, source: "file" };
    }
    if (envKey) {
      return {
        credential: { type: "api_key", provider, apiKey: envKey, savedAt: 0 },
        source: "env",
      };
    }
  }
  return null;
}

export function deleteApiKey(provider: ApiKeyProvider): boolean {
  return deleteCredential(provider);
}

// --- OAuth ---

export function saveOAuthToken(
  provider: OAuthProvider,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number
): void {
  if (!OAUTH_PROVIDERS.has(provider)) {
    throw new Error(`Provider OAuth non supportato: ${provider}`);
  }
  const token = accessToken.trim();
  if (!token) throw new Error("Access token vuoto");

  const credential: OAuthCredential = {
    type: "oauth",
    provider,
    accessToken: token,
    refreshToken,
    expiresAt,
    savedAt: Date.now(),
  };
  writeCredential(provider, credential);
}

export function resolveOAuthToken(provider: OAuthProvider): (OAuthCredential & { isExpired: boolean }) | null {
  if (!OAUTH_PROVIDERS.has(provider)) {
    throw new Error(`Provider OAuth non supportato: ${provider}`);
  }
  const credential = readCredential(provider) as OAuthCredential | null;
  if (!credential || credential.type !== "oauth") return null;

  const isExpired = credential.expiresAt != null && Date.now() > credential.expiresAt;
  return { ...credential, isExpired };
}

export function deleteOAuthToken(provider: OAuthProvider): boolean {
  return deleteCredential(provider);
}

// --- Interfaccia unificata ---

export function resolveCredential(
  provider: Provider,
  precedence: CredentialPrecedence = "env-first"
): ResolvedCredential | null {
  if (API_KEY_PROVIDERS.has(provider as ApiKeyProvider)) {
    return resolveApiKey(provider as ApiKeyProvider, precedence);
  }
  if (OAUTH_PROVIDERS.has(provider as OAuthProvider)) {
    const result = resolveOAuthToken(provider as OAuthProvider);
    if (result) {
      const { isExpired, ...credential } = result;
      return { credential, source: "file" };
    }
    return null;
  }
  throw new Error(`Provider sconosciuto: ${provider}`);
}

export function listConfiguredProviders(): Array<{
  provider: string;
  type: string;
  source: CredentialSource;
}> {
  const configured: Array<{ provider: string; type: string; source: CredentialSource }> = [];

  for (const provider of API_KEY_PROVIDERS) {
    const envKey = readEnvKey(provider);
    if (envKey) {
      configured.push({ provider, type: "api_key", source: "env" });
    } else if (hasStoredCredential(provider)) {
      configured.push({ provider, type: "api_key", source: "file" });
    }
  }

  for (const provider of OAUTH_PROVIDERS) {
    if (hasStoredCredential(provider)) {
      configured.push({ provider, type: "oauth", source: "file" });
    }
  }

  return configured;
}
