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
  type LoginDeps,
} from "./supabase";

const CALLBACK = "http://127.0.0.1:54917/auth/callback";
const PROJECT = "https://example-ref.supabase.co";

// Le stesse regole del backend Rust (src-tauri/src/auth_store.rs e
// auth_login.rs): se supabase-js cambia forma, il rosso esce qui e non
// soltanto nell'app accesa.
const RUST_STORE_NAME = /^(?!\.)[A-Za-z0-9._-]{1,128}$/;

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const auth = {
    signInWithOAuth: vi.fn().mockResolvedValue({
      data: { provider: "google", url: `${PROJECT}/auth/v1/authorize?provider=google` },
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
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: ` ${PROJECT} `, VITE_SUPABASE_ANON_KEY: " k " }),
    ).toEqual({ configured: true, url: PROJECT, anonKey: "k" });
  });
});

describe("signInWithGoogle", () => {
  it("asks for the URL without redirecting, lets the backend wait, then exchanges the code", async () => {
    const client = fakeClient();
    const invoke = backend(async () => "code-123");
    await signInWithGoogle(deps(client, invoke));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: CALLBACK,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    expect(invoke).toHaveBeenCalledWith("auth_google_login", {
      authorizeUrl: `${PROJECT}/auth/v1/authorize?provider=google`,
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("code-123");
  });

  it("maps the backend refusals to login errors", async () => {
    const cases: Array<[unknown, string, string | null]> = [
      [{ code: "port_busy", detail: null }, "port-busy", null],
      [{ code: "denied", detail: "User denied" }, "denied", "User denied"],
      [{ code: "timed_out" }, "timed-out", null],
      [{ code: "cancelled" }, "cancelled", null],
      [{ code: "something_new" }, "unknown", null],
      ["plain string", "unknown", null],
    ];
    for (const [rejection, code, detail] of cases) {
      const client = fakeClient();
      const attempt = signInWithGoogle(deps(client, backend(() => Promise.reject(rejection))));
      await expect(attempt).rejects.toMatchObject({ code, detail });
      expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    }
  });

  it("refuses before touching anything when the build has no project or is not the desktop", async () => {
    const client = fakeClient();
    const invoke = backend(async () => "code");
    await expect(
      signInWithGoogle({ ...deps(client, invoke), configured: false }),
    ).rejects.toMatchObject({ code: "not-configured" });
    await expect(signInWithGoogle({ ...deps(client, invoke), desktop: false })).rejects.toMatchObject(
      { code: "not-desktop" },
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("reports a failed exchange", async () => {
    const client = fakeClient({
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "invalid flow state" },
      }),
    });
    const attempt = signInWithGoogle(deps(client, backend(async () => "code")));
    await expect(attempt).rejects.toBeInstanceOf(LoginError);
    await expect(attempt).rejects.toMatchObject({ code: "exchange-failed" });
  });
});

describe("the real supabase-js client against the backend's rules", () => {
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
    await signInWithGoogle({
      client,
      configured: true,
      desktop: true,
      invoke: (async (command: string, args?: Record<string, unknown>) => {
        if (command === "auth_callback_url") return CALLBACK;
        authorizeUrl = String(args?.authorizeUrl);
        return "0b8f1c2e-1234-4d5e-9abc-def012345678";
      }) as LoginDeps["invoke"],
    });

    const url = new URL(authorizeUrl);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("redirect_to")).toBe(CALLBACK);
    expect(url.searchParams.get("code_challenge_method")?.toLowerCase()).toBe("s256");

    const exchange = requests.find((request) => request.url.includes("grant_type=pkce"));
    expect(exchange?.body).toMatchObject({
      auth_code: "0b8f1c2e-1234-4d5e-9abc-def012345678",
      code_verifier: expect.any(String),
    });

    const names = setItem.mock.calls.map(([name]) => name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(RUST_STORE_NAME);
    const session = await client.auth.getSession();
    expect(session.data.session?.refresh_token).toBe("refresh-test");
  });
});

describe("signOut", () => {
  it("revokes only this app's session", async () => {
    const client = fakeClient();
    await signOut(client);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
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
