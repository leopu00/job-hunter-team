import { invoke, isTauri } from "@tauri-apps/api/core";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

/**
 * Il client Supabase della desktop: lo stesso progetto del web, con la
 * sessione dell'utente (anon key + JWT). Il filtro per utente è la RLS, come
 * in `web/lib/queries.ts`: qui non entra mai una chiave service_role.
 *
 * URL e anon key arrivano dall'ambiente di build (`VITE_SUPABASE_URL`,
 * `VITE_SUPABASE_ANON_KEY`, per esempio in `desktop/.env.local`). Senza, il
 * modulo si importa lo stesso: `supabaseConfigured` è false, il login lo dice
 * e le query falliscono invece di far saltare l'app all'avvio.
 */

export interface SupabaseEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export type SupabaseConfig =
  | { configured: true; url: string; anonKey: string }
  | { configured: false; reason: "missing-url" | "invalid-url" | "missing-anon-key" };

export function readSupabaseConfig(env: SupabaseEnv): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL?.trim() ?? "";
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url) return { configured: false, reason: "missing-url" };
  if (!anonKey) return { configured: false, reason: "missing-anon-key" };
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return { configured: false, reason: "invalid-url" };
    }
    return { configured: true, url: parsed.origin, anonKey };
  } catch {
    return { configured: false, reason: "invalid-url" };
  }
}

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface DeferredAuthStorage {
  storage: AuthStorage;
  unlock: () => void;
}

/**
 * auth-js può costruire subito il client, ma nessuna operazione sullo storage
 * raggiunge Tauri finché prepare non ha sbloccato il portachiavi. Le chiamate
 * anticipate restano in attesa: non osservano mai un falso valore nullo.
 */
export function deferAuthStorage(storage: AuthStorage): DeferredAuthStorage {
  let unlocked = false;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const wait = () => unlocked ? Promise.resolve() : ready;
  return {
    storage: {
      async getItem(key) { await wait(); return storage.getItem(key); },
      async setItem(key, value) { await wait(); await storage.setItem(key, value); },
      async removeItem(key) { await wait(); await storage.removeItem(key); },
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      release();
    },
  };
}

/**
 * Sessione e code verifier vanno nell'archivio cifrato del backend Rust
 * (chiave nel portachiavi del sistema), non nel localStorage della webview.
 */
const rawTauriAuthStorage: AuthStorage = {
  async getItem(key) {
    return (await invoke<string | null>("auth_store_get", { name: key })) ?? null;
  },
  async setItem(key, value) {
    await invoke("auth_store_set", { name: key, value });
  },
  async removeItem(key) {
    await invoke("auth_store_remove", { name: key });
  },
};
const deferredTauriAuthStorage = deferAuthStorage(rawTauriAuthStorage);
export const tauriAuthStorage: AuthStorage = deferredTauriAuthStorage.storage;

/** Fuori da Tauri (vitest, `npm run dev` nel browser) la sessione vive in memoria. */
export function memoryAuthStorage(): AuthStorage {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

// `.invalid` non si risolve mai (RFC 2606): senza configurazione ogni
// chiamata fallisce in rete, senza parlare con nessuno.
const UNCONFIGURED_URL = "https://supabase-not-configured.invalid";
const UNCONFIGURED_KEY = "not-configured";

export function createDesktopSupabase(config: SupabaseConfig, storage: AuthStorage): SupabaseClient {
  return createClient(
    config.configured ? config.url : UNCONFIGURED_URL,
    config.configured ? config.anonKey : UNCONFIGURED_KEY,
    {
      auth: {
        flowType: "pkce",
        // Fa tornare l'id casuale del flow sul loopback: il backend rifiuta
        // callback di un altro tentativo e lo scambio seleziona il verifier
        // salvato nello slot di quello stesso flow.
        experimental: { appendPkceFlowIdToRedirects: true },
        storage,
        persistSession: true,
        autoRefreshToken: config.configured,
        // Il ritorno del login non passa dall'URL della webview ma dal
        // listener su loopback del backend (src-tauri/src/auth_login.rs).
        detectSessionInUrl: false,
      },
    },
  );
}

export const supabaseConfig = readSupabaseConfig(import.meta.env as SupabaseEnv);
export const supabaseConfigured = supabaseConfig.configured;
export const supabase: SupabaseClient = createDesktopSupabase(
  supabaseConfig,
  isTauri() ? tauriAuthStorage : memoryAuthStorage(),
);

export type LoginErrorCode =
  | "not-configured"
  | "not-desktop"
  | "port-busy"
  | "browser-failed"
  | "browser-not-found"
  | "keychain-failed"
  | "denied"
  | "timed-out"
  | "cancelled"
  | "in-progress"
  | "exchange-failed"
  | "unknown";

export class LoginError extends Error {
  constructor(
    readonly code: LoginErrorCode,
    readonly detail: string | null = null,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LoginError";
  }
}

const BACKEND_ERRORS: Record<string, LoginErrorCode> = {
  auth_not_configured: "not-configured",
  port_busy: "port-busy",
  browser_failed: "browser-failed",
  browser_not_found: "browser-not-found",
  keychain_unavailable: "keychain-failed",
  denied: "denied",
  timed_out: "timed-out",
  cancelled: "cancelled",
  login_in_progress: "in-progress",
};

function toLoginError(error: unknown): LoginError {
  if (error instanceof LoginError) return error;
  if (error && typeof error === "object" && "code" in error) {
    const { code, detail } = error as { code: unknown; detail?: unknown };
    const mapped = typeof code === "string" ? BACKEND_ERRORS[code] : undefined;
    return new LoginError(mapped ?? "unknown", typeof detail === "string" ? detail : null);
  }
  return new LoginError("unknown");
}

export interface LoginDeps {
  client: SupabaseClient;
  configured: boolean;
  desktop: boolean;
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  unlockStorage?: () => void;
}

const defaultDeps = (): LoginDeps => ({
  client: supabase,
  configured: supabaseConfigured,
  desktop: isTauri(),
  invoke,
  unlockStorage: isTauri() ? deferredTauriAuthStorage.unlock : undefined,
});

const authInitializations = new WeakMap<SupabaseClient, Promise<void>>();

/**
 * Sblocca lo storage e inizializza auth-js una volta sola per client. Anche
 * un fallimento resta memorizzato: nessun secondo mount o retry può causare
 * un'altra richiesta al portachiavi nello stesso processo.
 */
export function initializeDesktopAuth(deps: LoginDeps = defaultDeps()): Promise<void> {
  const current = authInitializations.get(deps.client);
  if (current) return current;
  const initialization = (async () => {
    if (!deps.configured) return;
    if (deps.desktop) {
      try {
        await deps.invoke("auth_store_prepare");
      } catch (backendError) {
        throw toLoginError(backendError);
      }
      deps.unlockStorage?.();
    }
    try {
      const initialized = await deps.client.auth.initialize();
      if (initialized.error) throw new LoginError("unknown");
    } catch (error) {
      if (error instanceof LoginError) throw error;
      throw new LoginError("unknown");
    }
  })();
  authInitializations.set(deps.client, initialization);
  return initialization;
}

export interface SignInOptions {
  /**
   * Dove aprire la pagina di Google: `default` (il browser predefinito),
   * `manual` (nessuno: l'utente copia il link) o l'`id` di un browser di
   * `listBrowsers()`. Senza, il predefinito.
   */
  browser?: string;
  /** Riceve il link di autorizzazione appena c'è, per «Copia link». */
  onAuthorizeUrl?: (url: string) => void;
}

/**
 * Login Google, flusso PKCE: supabase-js prepara l'URL e salva il code
 * verifier, il backend lo apre nel browser scelto e aspetta il ritorno su
 * loopback, il codice si scambia qui per la sessione. A sessione salvata,
 * `useSession` cambia da solo.
 */
export async function signInWithGoogle(
  options: SignInOptions = {},
  deps: LoginDeps = defaultDeps(),
): Promise<void> {
  if (!deps.configured) throw new LoginError("not-configured");
  if (!deps.desktop) throw new LoginError("not-desktop");
  // Prima si sblocca/rilegge la sessione cifrata; soltanto dopo auth-js può
  // creare il verifier PKCE o aprire il browser.
  await initializeDesktopAuth(deps);
  const redirectTo = await deps.invoke<string>("auth_callback_url");
  const { data, error } = await deps.client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  const flowId = data?.flowId;
  if (error || !data?.url || !validFlowId(flowId)) {
    throw new LoginError("unknown", error?.message ?? null);
  }
  options.onAuthorizeUrl?.(data.url);
  let code: string;
  try {
    code = await deps.invoke<string>("auth_google_login", {
      authorizeUrl: data.url,
      browser: options.browser ?? "default",
      flowId,
    });
  } catch (backendError) {
    throw toLoginError(backendError);
  }
  const exchanged = await deps.client.auth.exchangeCodeForSession(code, { flowId });
  if (exchanged.error || !exchanged.data.session) {
    throw new LoginError("exchange-failed", exchanged.error?.message ?? null);
  }
}

function validFlowId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

/** Chiude l'attesa del ritorno dal browser: `signInWithGoogle` finisce con `cancelled`. */
export async function cancelGoogleSignIn(): Promise<void> {
  if (isTauri()) await invoke("auth_cancel_login");
}

/**
 * Esce da questa app soltanto: `scope: "local"` revoca la sessione della
 * desktop e lascia aperte quelle del web e degli altri dispositivi.
 */
export async function signOut(client: SupabaseClient = supabase): Promise<void> {
  const { error } = await client.auth.signOut({ scope: "local" });
  // Anche se la revoca in rete non riesce, la sessione locale è già cancellata.
  if (error) console.warn("[auth] sign-out revoke failed:", error.message);
}

export interface SessionState {
  session: Session | null;
  loading: boolean;
}

/** La sessione corrente, aggiornata a ogni login, refresh e logout. */
export function useSession(client: SupabaseClient = supabase): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    const initialization = client === supabase
      ? initializeDesktopAuth()
      : initializeDesktopAuth({ client, configured: true, desktop: false, invoke });
    void initialization.then(() => {
      if (!active) return;
      // INITIAL_SESSION arriva soltanto dopo lo sblocco e la rilettura. Un
      // getSession parallelo potrebbe invece arrivare dopo SIGNED_IN e
      // riportare indietro lo stato.
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        if (active) setState({ session, loading: false });
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch(() => {
      if (active) setState({ session: null, loading: false });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [client]);
  return state;
}
