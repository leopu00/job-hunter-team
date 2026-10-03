import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  canonicalProviderLoginUrl,
  isOnboardingAssistantReachable,
  isOnboardingProfileReady,
  isOnboardingRuntimeReady,
  loadLocalOnboardingGate,
  loadOnboardingGate,
  markOnboardingReady,
  markOnboardingStarted,
  OnboardingSaveError,
  resetOnboardingMarker,
  runtimeStateFromSnapshot,
  type OnboardingMarkerStore,
  type OnboardingRuntimeSnapshot,
} from "./onboarding";

describe("canonicalProviderLoginUrl", () => {
  it.each([
    ["claude", "https://console.anthropic.com/oauth", "https://console.anthropic.com/oauth"],
    ["codex", "https://AUTH.OPENAI.COM/device", "https://auth.openai.com/device"],
    ["kimi", "https://auth.kimi.com/device", "https://auth.kimi.com/device"],
  ] as const)("canonicalizes an allowlisted %s URL", (provider, input, expected) => {
    expect(canonicalProviderLoginUrl(provider, input)).toBe(expected);
  });

  it.each([
    "https://auth.openai.com/device\u001b[0m",
    "https://auth.openai.com/device%1B[0m",
    "https://auth.openai.com/device%0Aextra",
    " https://auth.openai.com/device",
    "http://auth.openai.com/device",
    "https://auth.openai.com:8443/device",
    "https://auth.openai.com.evil.invalid/device",
    "https://auth.openai.com/device?device_code=synthetic",
  ])("rejects a non-canonical or unsafe Codex URL", (input) => {
    expect(canonicalProviderLoginUrl("codex", input)).toBeNull();
  });

  it("rejects a valid host belonging to another provider", () => {
    expect(canonicalProviderLoginUrl("codex", "https://console.anthropic.com/oauth")).toBeNull();
  });

  it("rejects URL credentials", () => {
    const input = new URL("https://auth.openai.com/device");
    input.username = "synthetic-user";
    expect(canonicalProviderLoginUrl("codex", input.toString())).toBeNull();
  });
});

const USER = {
  id: "synthetic-user",
  email: "person@example.invalid",
  user_metadata: { full_name: "Persona Esempio" },
} as unknown as User;

const READY_RUNTIME: OnboardingRuntimeSnapshot = {
  runtimeInstalled: true,
  containerRunning: true,
  providerConfigured: true,
  providerAuthenticated: true,
  assistantRunning: true,
  captainRunning: true,
  profileReady: true,
  assistantWelcomed: true,
  directChatReady: true,
};

const READY_PROFILE = {
  user_id: USER.id,
  name: "Persona Esempio",
  email: USER.email,
  target_role: "Software Engineer",
  location: "Città Esempio",
  experience_years: 3,
  seniority_target: "mid",
  skills: { primary: ["TypeScript", "Testing"] },
  languages: [{ language: "Italiano" }],
};

function markerStore(): OnboardingMarkerStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(options: { milestones?: Result; profile?: Result; team?: Result }) {
  const calls: Array<{ table: string; op: string }> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "order", "limit"] as const) {
        chain[op] = () => { calls.push({ table, op }); return chain; };
      }
      chain.upsert = () => { calls.push({ table, op: "upsert" }); return Promise.resolve({ error: null }); };
      chain.maybeSingle = () => {
        calls.push({ table, op: "maybeSingle" });
        return Promise.resolve(table === "user_onboarding_state"
          ? options.milestones ?? { data: null, error: null }
          : table === "cloud_sync_tokens"
            ? options.team ?? { data: null, error: null }
            : options.profile ?? { data: null, error: null });
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("loadOnboardingGate", () => {
  it("starts a new account at technical host setup without writing personal data", async () => {
    const { client, calls } = fakeClient({ profile: { data: { name: "Partial" }, error: null } });

    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toEqual({
      phase: "required",
      account: { displayName: "Persona Esempio", identity: "google" },
      resumeAvailable: false,
      runtime: { status: "collecting", stage: "host" },
    });
    expect(calls.some((call) => call.op === "upsert")).toBe(false);
  });

  it("does not treat a profile milestone as a completed technical setup", async () => {
    const { client } = fakeClient({
      milestones: { data: { profile_configured_at: "2026-01-01T00:00:00Z" }, error: null },
      profile: { data: READY_PROFILE, error: null },
    });
    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toMatchObject({
      phase: "required",
      runtime: { status: "collecting", stage: "host" },
    });
  });

  it("offers only an opaque account-scoped id for an existing VPS team", async () => {
    const { client } = fakeClient({
      milestones: { data: { vps_setup_completed_at: "2026-01-01T00:00:00Z" }, error: null },
      team: { data: { id: "00000000-0000-4000-8000-000000000001" }, error: null },
    });
    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toMatchObject({
      phase: "required",
      existingTeam: {
        teamId: "00000000-0000-4000-8000-000000000001",
        status: "available",
      },
    });
  });

  it("fails closed when existing-team cloud state is offline", async () => {
    const { client } = fakeClient({
      team: { data: null, error: { message: "offline" } },
    });
    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toMatchObject({ phase: "error" });
  });

  it("keeps the legacy completed-account admission but never uses it after a new flow starts", async () => {
    const evidence = {
      milestones: { data: { first_team_run_at: "2026-01-01T00:00:00Z" }, error: null },
      profile: { data: READY_PROFILE, error: null },
    };
    await expect(loadOnboardingGate(fakeClient(evidence).client, USER, markerStore()))
      .resolves.toEqual({ phase: "ready" });

    const store = markerStore();
    markOnboardingStarted(USER.id, store);
    await expect(loadOnboardingGate(fakeClient(evidence).client, USER, store)).resolves.toMatchObject({
      phase: "required",
      runtime: { status: "collecting", stage: "host" },
    });
  });

  it("fails closed when durable account state cannot be read", async () => {
    const offline = { data: null, error: { message: "offline" } };
    await expect(loadOnboardingGate(fakeClient({ milestones: offline, profile: offline }).client, USER, markerStore()))
      .resolves.toMatchObject({ phase: "error" });
  });

  it("accepts only the final account-scoped marker", async () => {
    const staleStore = markerStore();
    staleStore.setItem(`jht.desktop.onboarding.${USER.id}`, "profile-v1");
    const stale = fakeClient({});
    await expect(loadOnboardingGate(stale.client, USER, staleStore)).resolves.toMatchObject({ phase: "required" });
    expect(stale.calls.length).toBeGreaterThan(0);

    const currentStore = markerStore();
    currentStore.setItem(`jht.desktop.onboarding.${USER.id}`, "subscription-v1");
    const current = fakeClient({});
    await expect(loadOnboardingGate(current.client, USER, currentStore)).resolves.toEqual({ phase: "ready" });
    expect(current.calls).toHaveLength(0);
  });
});

describe("loadLocalOnboardingGate", () => {
  it("uses only the device-local profile and never reads cloud state", () => {
    const store = markerStore();
    expect(loadLocalOnboardingGate("opaque-profile-a", "  Ada   Locale  ", store)).toEqual({
      phase: "required",
      account: { displayName: "Ada Locale", identity: "local" },
      resumeAvailable: false,
      runtime: { status: "collecting", stage: "host" },
    });
  });

  it("keeps start and completion markers isolated between local profiles", () => {
    const store = markerStore();
    markOnboardingStarted("local:opaque-profile-a", store);
    expect(loadLocalOnboardingGate("opaque-profile-a", "Ada", store)).toMatchObject({
      phase: "required",
      resumeAvailable: true,
    });
    expect(loadLocalOnboardingGate("opaque-profile-b", "Bea", store)).toMatchObject({
      phase: "required",
      resumeAvailable: false,
    });
    markOnboardingReady("local:opaque-profile-a", READY_RUNTIME, store);
    expect(loadLocalOnboardingGate("opaque-profile-a", "Ada", store)).toEqual({ phase: "ready" });
    expect(loadLocalOnboardingGate("opaque-profile-b", "Bea", store)).toMatchObject({ phase: "required" });
  });

  it("restarts a local flow without removing its profile or native state", () => {
    const store = markerStore();
    markOnboardingReady("local:opaque-profile-a", READY_RUNTIME, store);
    resetOnboardingMarker("local:opaque-profile-a", store);
    expect(loadLocalOnboardingGate("opaque-profile-a", "Ada", store)).toMatchObject({
      phase: "required",
      resumeAvailable: false,
      runtime: { status: "collecting", stage: "host" },
    });
    expect([...store.values.values()]).toEqual(["subscription-v1-restarted"]);
  });
});

describe("technical and conversational gates", () => {
  it("opens Assistant chat without a profile but marks ready only after profileReady", () => {
    const beforeConversation = { ...READY_RUNTIME, profileReady: false, assistantWelcomed: true };
    expect(isOnboardingAssistantReachable(beforeConversation)).toBe(true);
    expect(isOnboardingRuntimeReady(beforeConversation)).toBe(false);
    expect(() => markOnboardingReady(USER.id, beforeConversation, markerStore())).toThrowError(
      new OnboardingSaveError("runtime-not-ready"),
    );

    expect(isOnboardingRuntimeReady({ ...beforeConversation, profileReady: true })).toBe(true);
  });

  it("does not use the one-shot welcomed flag as a final gate", () => {
    expect(isOnboardingRuntimeReady({ ...READY_RUNTIME, assistantWelcomed: false })).toBe(true);
  });

  it("reports runtime and container failures at their exact retry stage", () => {
    expect(runtimeStateFromSnapshot({ ...READY_RUNTIME, runtimeInstalled: false })).toMatchObject({
      status: "failed", stage: "runtime",
    });
    expect(runtimeStateFromSnapshot({ ...READY_RUNTIME, containerRunning: false })).toMatchObject({
      status: "failed", stage: "container",
    });
    expect(runtimeStateFromSnapshot({ ...READY_RUNTIME, providerConfigured: false })).toMatchObject({
      status: "failed", stage: "provider",
    });
  });

  it("writes the final marker monotonically only with verified readiness", async () => {
    const store = markerStore();
    markOnboardingStarted(USER.id, store);
    expect([...store.values.values()]).toEqual(["subscription-v1-started"]);
    markOnboardingReady(USER.id, READY_RUNTIME, store);
    markOnboardingStarted(USER.id, store);
    expect([...store.values.values()]).toEqual(["subscription-v1"]);

    const { client, calls } = fakeClient({});
    await expect(loadOnboardingGate(client, USER, store)).resolves.toEqual({ phase: "ready" });
    expect(calls).toHaveLength(0);
  });

  it("keeps a Google restart at technical step 1 despite legacy completion evidence", async () => {
    const store = markerStore();
    markOnboardingReady(USER.id, READY_RUNTIME, store);
    resetOnboardingMarker(USER.id, store);
    const evidence = {
      milestones: { data: { first_team_run_at: "2026-01-01T00:00:00Z" }, error: null },
      profile: { data: READY_PROFILE, error: null },
    };

    await expect(loadOnboardingGate(fakeClient(evidence).client, USER, store)).resolves.toMatchObject({
      phase: "required",
      resumeAvailable: false,
      runtime: { status: "collecting", stage: "host" },
    });
  });
});

describe("isOnboardingProfileReady", () => {
  it("recognizes only real conversational profile evidence", () => {
    expect(isOnboardingProfileReady(READY_PROFILE)).toBe(true);
    expect(isOnboardingProfileReady({ ...READY_PROFILE, email: null })).toBe(false);
    expect(isOnboardingProfileReady({ ...READY_PROFILE, skills: { primary: ["one"] } })).toBe(false);
  });
});
