/**
 * Provider authentication methods for JHT.
 * Pattern ispirato a OpenClaw — ogni provider espone multipli metodi di auth.
 */
import type { WorkspaceProvider } from "../tui-profile.js";

export type AuthMethodKind = "apiKey" | "oauth" | "token";

export type AuthMethod = {
  id: string;
  label: string;
  hint?: string;
  kind: AuthMethodKind;
  run: (ctx: AuthContext) => Promise<AuthResult>;
};

export type AuthContext = {
  workspace: string;
  provider: WorkspaceProvider;
  prompt: PromptAPI;
  openUrl?: (url: string) => Promise<void>;
  runtime: RuntimeAPI;
};

export type AuthResult =
  | { success: true; credentials: Credentials }
  | { success: false; error: string };

export type Credentials =
  | { type: "apiKey"; key: string }
  | { type: "oauth"; token: string; refreshToken?: string; expiresAt?: number }
  | { type: "token"; token: string };

export type PromptAPI = {
  text: (params: { message: string; placeholder?: string; validate?: (v: string) => string | undefined }) => Promise<string>;
  confirm: (params: { message: string; initialValue?: boolean }) => Promise<boolean>;
  select: <T extends string>(params: { message: string; options: Array<{ value: T; label: string; hint?: string }> }) => Promise<T>;
  progress: (message: string) => { update: (msg: string) => void; stop: (msg?: string) => void };
  note: (message: string, title?: string) => Promise<void>;
};

export type RuntimeAPI = {
  log: (msg: string) => void;
  error: (msg: string) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// ANTHROPIC PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

const anthropicApiKeyAuth: AuthMethod = {
  id: "api-key",
  label: "API Key",
  hint: "sk-ant-...",
  kind: "apiKey",
  async run(ctx) {
    const key = await ctx.prompt.text({
      message: "Inserisci la chiave API Anthropic:",
      placeholder: "sk-ant-api03-...",
      validate: (v) => {
        if (!v.trim()) return "La chiave è obbligatoria";
        if (!v.startsWith("sk-ant-")) return "La chiave deve iniziare con sk-ant-";
        return undefined;
      },
    });

    ctx.runtime.log("Verifica chiave in corso...");
    const valid = await testAnthropicKey(key.trim());
    
    if (!valid) {
      return { success: false, error: "Chiave non valida o non verificabile" };
    }

    return { success: true, credentials: { type: "apiKey", key: key.trim() } };
  },
};

export const anthropicProvider = {
  id: "anthropic" as const,
  label: "Anthropic",
  description: "Claude via Messages API",
  auth: [anthropicApiKeyAuth],
};

// ─────────────────────────────────────────────────────────────────────────────
// OPENAI PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

const openaiApiKeyAuth: AuthMethod = {
  id: "api-key",
  label: "API Key",
  hint: "sk-...",
  kind: "apiKey",
  async run(ctx) {
    const key = await ctx.prompt.text({
      message: "Inserisci la chiave API OpenAI:",
      placeholder: "sk-proj-...",
      validate: (v) => {
        if (!v.trim()) return "La chiave è obbligatoria";
        if (!v.startsWith("sk-")) return "La chiave deve iniziare con sk-";
        return undefined;
      },
    });

    ctx.runtime.log("Verifica chiave in corso...");
    const valid = await testOpenAIKey(key.trim());
    
    if (!valid) {
      return { success: false, error: "Chiave non valida o non verificabile" };
    }

    return { success: true, credentials: { type: "apiKey", key: key.trim() } };
  },
};

const openaiOAuthAuth: AuthMethod = {
  id: "oauth",
  label: "OAuth (Codex)",
  hint: "Browser login",
  kind: "oauth",
  async run(ctx) {
    await ctx.prompt.note(
      [
        "Verrà aperto il browser per l'autenticazione OpenAI.",
        "Dopo il login, incolla l'URL di redirect qui.",
        "",
        "Nota: OAuth usa localhost:1455 per il callback.",
      ].join("\n"),
      "OpenAI OAuth"
    );

    const spin = ctx.prompt.progress("Avvio OAuth flow...");
    
    try {
      // Simulazione OAuth - in produzione useremmo @mariozechner/pi-ai/oauth
      // Per ora facciamo un fallback a input manuale token
      spin.update("Apertura browser...");
      
      const oauthUrl = "https://platform.openai.com/auth/codex"; // URL fittizio
      if (ctx.openUrl) {
        await ctx.openUrl(oauthUrl);
      }
      
      ctx.runtime.log(`\nApri questo URL nel browser:\n${oauthUrl}\n`);
      
      spin.stop("In attesa di autorizzazione...");
      
      const redirectUrl = await ctx.prompt.text({
        message: "Incolla l'URL di redirect (o il codice):",
        validate: (v) => v.trim() ? undefined : "Richiesto",
      });

      // Estrai token dall'URL (semplificato)
      const token = extractTokenFromRedirect(redirectUrl.trim());
      if (!token) {
        return { success: false, error: "Impossibile estrarre token dall'URL" };
      }

      return { 
        success: true, 
        credentials: { 
          type: "oauth", 
          token,
          expiresAt: Date.now() + 3600 * 1000, // 1 ora
        } 
      };
    } catch (err) {
      spin.stop("OAuth fallito");
      return { success: false, error: String(err) };
    }
  },
};

export const openaiProvider = {
  id: "openai" as const,
  label: "OpenAI",
  description: "Codex OAuth + API key",
  auth: [openaiOAuthAuth, openaiApiKeyAuth],
};

// ─────────────────────────────────────────────────────────────────────────────
// MOONSHOT AI (KIMI) PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

const kimiApiKeyAuth: AuthMethod = {
  id: "api-key",
  label: "API Key",
  hint: "sk-...",
  kind: "apiKey",
  async run(ctx) {
    const key = await ctx.prompt.text({
      message: "Inserisci la chiave API Moonshot AI:",
      placeholder: "sk-...",
      validate: (v) => !v.trim() ? "La chiave è obbligatoria" : undefined,
    });

    ctx.runtime.log("Verifica chiave in corso...");
    const valid = await testKimiKey(key.trim());
    
    if (!valid) {
      return { success: false, error: "Chiave non valida o non verificabile" };
    }

    return { success: true, credentials: { type: "apiKey", key: key.trim() } };
  },
};

export const kimiProvider = {
  id: "kimi" as const,
  label: "Moonshot AI",
  description: "Kimi K2.5",
  auth: [kimiApiKeyAuth],
};

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDERS = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  kimi: kimiProvider,
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export function getProvider(id: string): typeof PROVIDERS[ProviderId] | undefined {
  return PROVIDERS[id as ProviderId];
}

export function listProviders(): Array<{ id: ProviderId; label: string; description: string }> {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ 
    id: id as ProviderId, 
    label: p.label, 
    description: p.description 
  }));
}

export function getAuthMethods(providerId: ProviderId): AuthMethod[] {
  return PROVIDERS[providerId]?.auth ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST CREDENTIALS
// ─────────────────────────────────────────────────────────────────────────────

async function testAnthropicKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

async function testOpenAIKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

async function testKimiKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "kimi-k2-0711-preview",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractTokenFromRedirect(url: string): string | null {
  // Estrae token da URL tipo: http://localhost:1455/callback?code=xxx
  // o direttamente il code se l'utente incolla solo quello
  
  if (url.includes("code=")) {
    const match = url.match(/[?&]code=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  
  // Se l'utente ha incollato solo il code
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) {
    return url;
  }
  
  return null;
}

// Storage helpers
export async function saveCredentials(
  workspace: string, 
  provider: ProviderId, 
  methodId: string,
  credentials: Credentials
): Promise<void> {
  const { saveWorkspaceApiKey, saveWorkspaceProvider } = await import("../tui-profile.js");
  
  saveWorkspaceProvider(provider, workspace);
  
  if (credentials.type === "apiKey") {
    saveWorkspaceApiKey(credentials.key, workspace, provider);
  } else if (credentials.type === "oauth" || credentials.type === "token") {
    // Per OAuth/token, salva il token come "oauth:<token>"
    saveWorkspaceApiKey(`oauth:${credentials.token}`, workspace, provider);
  }
}
