import { act, renderHook } from "@testing-library/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopSupabase,
  LoginError,
  memoryAuthStorage,
  readSupabaseConfig,
  signInWithGoogle,
  signOut,
  useSession,
  type AuthStorage,
  type LoginDeps,
} from "./supabase";

const CALLBACK = "http://127.0.0.1:54917/auth/callback";
const PROJECT = "https://example-ref.supabase.co";
const FLOW_ID = "flow_12345678";

// Le stesse regole del backend Rust (src-tauri/src/auth_store.rs e
// auth_login.rs): se supabase-js cambia forma, il rosso esce qui e non
// soltanto nell'app accesa.
const RUST_STORE_NAME = /^sb-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?-auth-token(?:|-user|-code-verifier|-flows-code-verifier|-flow-[A-Za-z0-9_-]{8,64}-code-verifier)$/;

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const auth = {
    initialize: vi.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({
      data: { provider: "google", url: `${PROJECT}/auth/v1/authorize?provider=google`, flowId: FLOW_ID },
      error: null,
    }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({
      data: { session: { access_token: "a" }, user: {} },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
  return { auth } as unknown as SupabaseClient & { auth: typeof auth };
}

function deps(client: SupabaseClient, invoke: LoginDeps["invoke"]): LoginDeps {
  return { client, configured: true, desktop: true, invoke };
}

function backend(login: () => Promise<unknown>) {
  return vi.fn(async (command: string) => {
    if (command === "auth_store_prepare") return undefined;
    if (command === "auth_callback_url") return CALLBACK;
    if (command === "auth_google_login") return login();
    throw new Error(`unexpected command ${command}`);
  }) as unknown as LoginDeps["invoke"] & ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readSupabaseConfig", () => {
  it("wants an https URL and an anon key", () => {
    expect(readSupabaseConfig({})).toEqual({ configured: false, reason: "missing-url" });
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: PROJECT })).toEqual({
      configured: false,
      reason: "missing-anon-key",
    });
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: "http://example.com", VITE_SUPABASE_ANON_KEY: "k" }),
    ).toEqual({ configured: false, reason: "invalid-url" });
    for (const url of [`${PROJECT}/auth/v1`, `${PROJECT}?next=evil`, "https://user@example.com"]) {
      expect(readSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: "k" })).toEqual({
        configured: false,
        reason: "invalid-url",
      });
    }
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: ` ${PROJECT} `, VITE_SUPABASE_ANON_KEY: " k " }),
    ).toEqual({ configured: true, url: PROJECT, anonKey: "k" });
  });
});

describe("signInWithGoogle", () => {
  it("asks for the URL without redirecting, lets the backend wait, then exchanges the code", async () => {
    const client = fakeClient();
    const invoke = backend(async () => "code-123");
    const onAuthorizeUrl = vi.fn();
    await signInWithGoogle({ browser: "chrome-canary", onAuthorizeUrl }, deps(client, invoke));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: CALLBACK,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    expect(client.auth.initialize).toHaveBeenCalledOnce();
    expect(onAuthorizeUrl).toHaveBeenCalledWith(`${PROJECT}/auth/v1/authorize?provider=google`);
    expect(invoke).toHaveBeenCalledWith("auth_google_login", {
      authorizeUrl: `${PROJECT}/auth/v1/authorize?provider=google`,
      browser: "chrome-canary",
      flowId: FLOW_ID,
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("code-123", { flowId: FLOW_ID });
  });

  it("opens the default browser when no choice is given", async () => {
    const invoke = backend(async () => "code");
    await signInWithGoogle({}, deps(fakeClient(), invoke));
    expect(invoke).toHaveBeenCalledWith("auth_google_login", expect.objectContaining({ browser: "default" }));
  });

  it("maps the backend refusals to login errors", async () => {
    const cases: Array<[unknown, string, string | null]> = [
      [{ code: "auth_not_configured" }, "not-configured", null],
      [{ code: "port_busy", detail: null }, "port-busy", null],
      [{ code: "browser_not_found" }, "browser-not-found", null],
      [{ code: "denied", detail: "User denied" }, "denied", "User denied"],
      [{ code: "timed_out" }, "timed-out", null],
      [{ code: "cancelled" }, "cancelled", null],
      [{ code: "something_new" }, "unknown", null],
      ["plain string", "unknown", null],
    ];
    for (const [rejection, code, detail] of cases) {
      const client = fakeClient();
      const attempt = signInWithGoogle({}, deps(client, backend(() => Promise.reject(rejection))));
      await expect(attempt).rejects.toMatchObject({ code, detail });
      expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    }
  });

  it("refuses before touching anything when the build has no project or is not the desktop", async () => {
    const client = fakeClient();
    const invoke = backend(async () => "code");
    await expect(
      signInWithGoogle({}, { ...deps(client, invoke), configured: false }),
    ).rejects.toMatchObject({ code: "not-configured" });
    await expect(signInWithGoogle({}, { ...deps(client, invoke), desktop: false })).rejects.toMatchObject(
      { code: "not-desktop" },
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("stops before the browser when the keychain refuses the session key", async () => {
    const client = fakeClient();
    const invoke = vi.fn(async (command: string) => {
      if (command === "auth_store_prepare") throw { code: "keychain_unavailable" };
      return CALLBACK;
    }) as unknown as LoginDeps["invoke"];
    await expect(signInWithGoogle({}, deps(client, invoke))).rejects.toMatchObject({
      code: "keychain-failed",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it.each([
    ["returned error", vi.fn().mockResolvedValue({ error: { message: "private startup detail" } })],
    ["rejection", vi.fn().mockRejectedValue(new Error("private startup failure"))],
  ])("fails closed on initialize %s without creating a PKCE flow", async (_case, initialize) => {
    const verifierWrite = vi.fn();
    const client = fakeClient({
      initialize,
      signInWithOAuth: vi.fn(async () => {
        verifierWrite();
        return {
          data: { provider: "google", url: `${PROJECT}/auth/v1/authorize?provider=google`, flowId: FLOW_ID },
          error: null,
        };
      }),
    });
    const invoke = backend(async () => "code");
    const onAuthorizeUrl = vi.fn();

    await expect(signInWithGoogle({ onAuthorizeUrl }, deps(client, invoke))).rejects.toEqual(
      new LoginError("unknown"),
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("auth_store_prepare");
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifierWrite).not.toHaveBeenCalled();
    expect(onAuthorizeUrl).not.toHaveBeenCalled();
  });

  it("reports a failed exchange", async () => {
    const client = fakeClient({
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "invalid flow state" },
      }),
    });
    const attempt = signInWithGoogle({}, deps(client, backend(async () => "code")));
    await expect(attempt).rejects.toBeInstanceOf(LoginError);
    await expect(attempt).rejects.toMatchObject({ code: "exchange-failed" });
  });

  it("keeps parallel attempts on separate flow ids and verifiers", async () => {
    let finishFirst!: (code: string) => void;
    const firstCode = new Promise<string>((resolve) => {
      finishFirst = resolve;
    });
    let logins = 0;
    const invoke = vi.fn(async (command: string) => {
      if (command === "auth_store_prepare") return undefined;
      if (command === "auth_callback_url") return CALLBACK;
      if (command === "auth_google_login") {
        logins += 1;
        if (logins === 1) return firstCode;
        throw { code: "login_in_progress" };
      }
      throw new Error(`unexpected command ${command}`);
    }) as unknown as LoginDeps["invoke"];
    const first = fakeClient({
      signInWithOAuth: vi.fn().mockResolvedValue({
        data: { provider: "google", url: `${PROJECT}/auth/v1/authorize?first`, flowId: "parallel_flow_1" },
        error: null,
      }),
    });
    const second = fakeClient({
      signInWithOAuth: vi.fn().mockResolvedValue({
        data: { provider: "google", url: `${PROJECT}/auth/v1/authorize?second`, flowId: "parallel_flow_2" },
        error: null,
      }),
    });

    const firstAttempt = signInWithGoogle({}, deps(first, invoke));
    await vi.waitFor(() => expect(logins).toBe(1));
    await expect(signInWithGoogle({}, deps(second, invoke))).rejects.toMatchObject({ code: "in-progress" });
    finishFirst("first-code");
    await firstAttempt;

    expect(first.auth.exchangeCodeForSession).toHaveBeenCalledWith("first-code", {
      flowId: "parallel_flow_1",
    });
    expect(second.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    const loginArgs = vi.mocked(invoke).mock.calls
      .filter(([command]) => command === "auth_google_login")
      .map(([, args]) => args);
    expect(loginArgs).toEqual([
      expect.objectContaining({ flowId: "parallel_flow_1" }),
      expect.objectContaining({ flowId: "parallel_flow_2" }),
    ]);
  });

  it("waits for startup cleanup before storing the new PKCE verifier", async () => {
    const storageKey = "sb-example-ref-auth-token";
    const values = new Map<string, string>([[storageKey, JSON.stringify({ stale: true })]]);
    let releaseStartup!: () => void;
    let startupRead = true;
    let released = false;
    const startupGate = new Promise<void>((resolve) => {
      releaseStartup = () => {
        if (released) return;
        released = true;
        resolve();
      };
    });
    const storage: AuthStorage = {
      async getItem(key) {
        if (key === storageKey && startupRead) {
          startupRead = false;
          await startupGate;
        }
        return values.get(key) ?? null;
      },
      async setItem(key, value) {
        values.set(key, value);
        // Senza l'attesa esplicita di initialize(), il vecchio percorso arriva
        // qui mentre il cleanup iniziale è sospeso e perde subito il verifier.
        if (key === `${storageKey}-code-verifier`) releaseStartup();
      },
      async removeItem(key) {
        values.delete(key);
      },
    };
    const client = createDesktopSupabase(
      { configured: true, url: PROJECT, anonKey: "anon-test-key" },
      storage,
    );
    const fallback = setTimeout(releaseStartup, 100);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        JSON.stringify({
          access_token: "header.payload.signature",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "refresh-test",
          user: { id: "00000000-0000-4000-8000-000000000000", aud: "authenticated" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );

    try {
      await signInWithGoogle({}, deps(client, backend(async () => "code-123")));
    } finally {
      clearTimeout(fallback);
      releaseStartup();
    }

    const session = await client.auth.getSession();
    expect(session.data.session?.refresh_token).toBe("refresh-test");
  });
});

describe("the real supabase-js client against the backend's rules", () => {
  it("stores parallel PKCE verifiers in separate flow slots", async () => {
    const storage = memoryAuthStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const client = createDesktopSupabase(
      { configured: true, url: PROJECT, anonKey: "anon-test-key" },
      storage,
    );

    const [first, second] = await Promise.all([
      client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: CALLBACK, skipBrowserRedirect: true },
      }),
      client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: CALLBACK, skipBrowserRedirect: true },
      }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data.flowId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(second.data.flowId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(first.data.flowId).not.toBe(second.data.flowId);
    for (const response of [first, second]) {
      const flowId = response.data.flowId!;
      expect(new URL(new URL(response.data.url!).searchParams.get("redirect_to")!).searchParams.get("sb_flow_id"))
        .toBe(flowId);
      expect(setItem).toHaveBeenCalledWith(
        `sb-example-ref-auth-token-flow-${flowId}-code-verifier`,
        expect.any(String),
      );
    }
  });

  it("builds an authorize URL the backend accepts, and keeps the verifier and session in our storage", async () => {
    const storage = memoryAuthStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const client = createDesktopSupabase(
      { configured: true, url: PROJECT, anonKey: "anon-test-key" },
      storage,
    );
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(
          JSON.stringify({
            access_token: "header.payload.signature",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-test",
            user: { id: "00000000-0000-4000-8000-000000000000", aud: "authenticated" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    let authorizeUrl = "";
    let selectedFlowId = "";
    await signInWithGoogle({}, {
      client,
      configured: true,
      desktop: true,
      invoke: (async (command: string, args?: Record<string, unknown>) => {
        if (command === "auth_store_prepare") return undefined;
        if (command === "auth_callback_url") return CALLBACK;
        authorizeUrl = String(args?.authorizeUrl);
        selectedFlowId = String(args?.flowId);
        return "0b8f1c2e-1234-4d5e-9abc-def012345678";
      }) as LoginDeps["invoke"],
    });

    const url = new URL(authorizeUrl);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/auth/v1/authorize");
    const redirect = new URL(url.searchParams.get("redirect_to")!);
    expect(redirect.origin + redirect.pathname).toBe(CALLBACK);
    expect(redirect.searchParams.get("sb_flow_id")).toBe(selectedFlowId);
    expect(url.searchParams.get("code_challenge_method")?.toLowerCase()).toBe("s256");

    const exchange = requests.find((request) => request.url.includes("grant_type=pkce"));
    expect(exchange?.body).toMatchObject({
      auth_code: "0b8f1c2e-1234-4d5e-9abc-def012345678",
      code_verifier: expect.any(String),
    });
    expect(selectedFlowId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    const names = setItem.mock.calls.map(([name]) => name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(RUST_STORE_NAME);
    const session = await client.auth.getSession();
    expect(session.data.session?.refresh_token).toBe("refresh-test");
  });
});

describe("signOut", () => {
  it("closes scoped runtime resources before revoking only this app's session", async () => {
    const order: string[] = [];
    const client = fakeClient({
      signOut: vi.fn(async () => {
        order.push("session");
        return { error: null };
      }),
    });
    const clearAccountScope = vi.fn(async () => { order.push("scope"); });

    await signOut(client, clearAccountScope);

    expect(clearAccountScope).toHaveBeenCalledOnce();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(order).toEqual(["scope", "session"]);
  });

  it("keeps the authenticated session when scoped teardown cannot be verified", async () => {
    const client = fakeClient();
    const clearAccountScope = vi.fn().mockRejectedValue({ code: "account_scope_reset_failed" });

    await expect(signOut(client, clearAccountScope)).rejects.toEqual({ code: "account_scope_reset_failed" });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("useSession", () => {
  it("is loading until the first auth event, then follows sign-in and sign-out", () => {
    let emit: (event: string, session: Session | null) => void = () => undefined;
    const unsubscribe = vi.fn();
    const client = {
      auth: {
        onAuthStateChange: vi.fn((callback: typeof emit) => {
          emit = callback;
          return { data: { subscription: { unsubscribe } } };
        }),
      },
    } as unknown as SupabaseClient;

    const { result, unmount } = renderHook(() => useSession(client));
    expect(result.current).toEqual({ session: null, loading: true });

    act(() => emit("INITIAL_SESSION", null));
    expect(result.current).toEqual({ session: null, loading: false });

    const session = { access_token: "a" } as Session;
    act(() => emit("SIGNED_IN", session));
    expect(result.current).toEqual({ session, loading: false });

    act(() => emit("SIGNED_OUT", null));
    expect(result.current.session).toBeNull();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
