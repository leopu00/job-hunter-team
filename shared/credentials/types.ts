/**
 * Tipi per il sistema di gestione credenziali.
 *
 * Definisce strutture per provider, credenziali, precedenza
 * di risoluzione e risultati delle operazioni.
 */

/** Provider supportati per API key diretta */
export type ApiKeyProvider = "claude" | "openai" | "minimax";

/** Provider supportati per subscription OAuth */
export type OAuthProvider = "chatgpt_pro" | "claude_max";

/** Tutti i provider supportati */
export type Provider = ApiKeyProvider | OAuthProvider;

/** Sorgente da cui è stata risolta la credenziale */
export type CredentialSource = "env" | "file" | "config" | "none";

/** Precedenza nella catena di risoluzione */
export type CredentialPrecedence = "env-first" | "file-first";

/** Tipo di credenziale */
export type CredentialType = "api_key" | "oauth";

/** Credenziale API key */
export type ApiKeyCredential = {
  type: "api_key";
  provider: ApiKeyProvider;
  apiKey: string;
  savedAt: number;
};

/** Credenziale OAuth subscription */
export type OAuthCredential = {
  type: "oauth";
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  savedAt: number;
};

/** Unione dei tipi credenziale */
export type Credential = ApiKeyCredential | OAuthCredential;

/** Risultato risoluzione credenziale */
export type ResolvedCredential = {
  credential: Credential;
  source: CredentialSource;
};

/** Dati criptati salvati su disco */
export type EncryptedPayload = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;       // hex
  authTag: string;  // hex
  data: string;     // hex (ciphertext)
};

/** Mapping provider → variabile d'ambiente */
export const ENV_VAR_MAP: Record<ApiKeyProvider, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
};

/** Set provider API key */
export const API_KEY_PROVIDERS = new Set<ApiKeyProvider>([
  "claude", "openai", "minimax",
]);

/** Set provider OAuth */
export const OAUTH_PROVIDERS = new Set<OAuthProvider>([
  "chatgpt_pro", "claude_max",
]);

/** Tutti i provider validi */
export const ALL_PROVIDERS = new Set<Provider>([
  ...API_KEY_PROVIDERS, ...OAUTH_PROVIDERS,
]);
