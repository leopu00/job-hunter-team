/**
 * OpenAI OAuth flow implementation.
 * Pattern ispirato a OpenClaw — OAuth 2.0 PKCE per Codex CLI.
 */
import { randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────────────────────────────────────────────────────────────────
// TIPI
// ─────────────────────────────────────────────────────────────────────────────

export type OAuthCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // timestamp ms
  tokenType: string;
  scope?: string;
};

export type OAuthHandlers = {
  onAuth: (params: { url: string }) => Promise<void>;
  onPrompt: (params: { message: string; placeholder?: string }) => Promise<string>;
  onProgress?: (message: string) => void;
};

export type OAuthResult =
  | { success: true; credentials: OAuthCredentials }
  | { success: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAZIONE
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_OAUTH_CONFIG = {
  clientId: "codex_cli",
  authorizationEndpoint: "https://auth.openai.com/authorize",
  tokenEndpoint: "https://auth.openai.com/token",
  redirectUri: "http://localhost:1455/callback",
  scopes: ["openid", "profile", "email", "offline_access", "model.request", "model.read"],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PKCE UTILS
// ─────────────────────────────────────────────────────────────────────────────

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER CALLBACK
// ─────────────────────────────────────────────────────────────────────────────

function createCallbackServer(params: {
  state: string;
  onCode: (code: string) => void;
  onError: (error: string) => void;
}): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:1455`);
    
    // Health check per verificare che il server sia up
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    // Callback OAuth
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #e74c3c;">❌ Autenticazione Fallita</h1>
              <p>${errorDescription || error}</p>
              <p>Puoi chiudere questa finestra.</p>
            </body>
          </html>
        `);
        params.onError(errorDescription || error);
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #e74c3c;">❌ Codice Mancante</h1>
              <p>La risposta OAuth non contiene un codice di autorizzazione.</p>
            </body>
          </html>
        `);
        params.onError("Codice di autorizzazione mancante");
        return;
      }

      if (state !== params.state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1 style="color: #e74c3c;">❌ State Non Valido</h1>
              <p>La verifica di sicurezza state è fallita.</p>
            </body>
          </html>
        `);
        params.onError("State parameter mismatch");
        return;
      }

      // Successo!
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #1a1a2e; color: #eee;">
            <h1 style="color: #4ade80;">✅ Autenticazione Completata!</h1>
            <p>Hai effettuato l'accesso con successo a OpenAI.</p>
            <p>Puoi chiudere questa finestra e tornare al terminale.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      params.onCode(code);
      return;
    }

    // 404
    res.writeHead(404);
    res.end("Not found");
  });

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN EXCHANGE
// ─────────────────────────────────────────────────────────────────────────────

async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
}): Promise<OAuthResult> {
  try {
    const response = await fetch(OPENAI_OAUTH_CONFIG.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: OPENAI_OAUTH_CONFIG.clientId,
        code: params.code,
        code_verifier: params.codeVerifier,
        redirect_uri: OPENAI_OAUTH_CONFIG.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Token exchange failed: ${error}` };
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    return {
      success: true,
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        tokenType: data.token_type,
        scope: data.scope,
      },
    };
  } catch (err) {
    return { success: false, error: `Network error: ${String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH TOKEN
// ─────────────────────────────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<OAuthResult> {
  try {
    const response = await fetch(OPENAI_OAUTH_CONFIG.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: OPENAI_OAUTH_CONFIG.clientId,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Refresh failed: ${error}` };
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    return {
      success: true,
      credentials: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
        tokenType: data.token_type,
        scope: data.scope,
      },
    };
  } catch (err) {
    return { success: false, error: `Network error: ${String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FLOW
// ─────────────────────────────────────────────────────────────────────────────

export async function loginOpenAIOAuth(handlers: OAuthHandlers): Promise<OAuthResult> {
  const { onAuth, onPrompt, onProgress } = handlers;

  // Genera PKCE e state
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = generateState();

  // Costruisci URL autorizzazione
  const authUrl = new URL(OPENAI_OAUTH_CONFIG.authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", OPENAI_OAUTH_CONFIG.clientId);
  authUrl.searchParams.set("redirect_uri", OPENAI_OAUTH_CONFIG.redirectUri);
  authUrl.searchParams.set("scope", OPENAI_OAUTH_CONFIG.scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Avvia server callback
  onProgress?.("Avvio server callback...");
  
  let codePromiseResolve: (code: string) => void;
  let codePromiseReject: (error: string) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    codePromiseResolve = resolve;
    codePromiseReject = reject;
  });

  const server = createCallbackServer({
    state,
    onCode: (code) => codePromiseResolve(code),
    onError: (error) => codePromiseReject(error),
  });

  // Avvia server
  await new Promise<void>((resolve, reject) => {
    server.listen(1455, () => {
      onProgress?.("Server pronto su localhost:1455");
      resolve();
    });
    server.on("error", (err) => reject(err));
  });

  try {
    // Apri browser
    onProgress?.("Apertura browser per autenticazione...");
    await onAuth({ url: authUrl.toString() });

    // Attendi callback
    onProgress?.("In attesa di autorizzazione...");
    
    // Timeout di 5 minuti
    const timeout = setTimeout(() => {
      codePromiseReject("Timeout: autenticazione non completata entro 5 minuti");
    }, 5 * 60 * 1000);

    const code = await codePromise;
    clearTimeout(timeout);

    onProgress?.("Scambio codice per token...");
    const result = await exchangeCodeForTokens({ code, codeVerifier });

    return result;
  } finally {
    server.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAZIONE TOKEN
// ─────────────────────────────────────────────────────────────────────────────

export async function validateOpenAIToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
