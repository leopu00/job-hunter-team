import type { SupabaseClient, User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  isOnboardingProfileReady,
  isOnboardingRuntimeReady,
  loadOnboardingGate,
  markOnboardingReady,
  OnboardingSaveError,
  runtimeStateFromSnapshot,
  saveOnboardingProfile,
  type OnboardingMarkerStore,
  type OnboardingProfileDraft,
  type OnboardingRuntimeSnapshot,
} from "./onboarding";

const USER = {
  id: "synthetic-user",
  email: "person@example.invalid",
  user_metadata: { full_name: "Persona Esempio" },
} as unknown as User;

const DRAFT: OnboardingProfileDraft = {
  fullName: "Persona Esempio",
  targetRole: "Software Engineer",
  location: "Città Esempio",
  experienceYears: 3,
  skills: ["TypeScript", "Testing"],
  languages: ["Italiano", "English"],
  workMode: "hybrid",
  notes: "Preferenza sintetica.",
};

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

function markerStore(): OnboardingMarkerStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(options: {
  milestones?: Result;
  profile?: Result;
  writeError?: boolean;
  reread?: Result;
}) {
  const calls: Array<{ table: string; op: string; value?: unknown }> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq"]) {
        chain[op] = (...args: unknown[]) => {
          calls.push({ table, op, value: args });
          return chain;
        };
      }
      chain.upsert = (value: unknown) => {
        calls.push({ table, op: "upsert", value });
        return Promise.resolve({
          data: null,
          error: options.writeError ? { message: "synthetic write failure" } : null,
        });
      };
      chain.maybeSingle = () => {
        calls.push({ table, op: "maybeSingle" });
        if (table === "user_onboarding_state") {
          return Promise.resolve(options.milestones ?? { data: null, error: null });
        }
        return Promise.resolve(options.reread ?? options.profile ?? { data: null, error: null });
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function savedProfile(extra: Record<string, unknown> = {}) {
  return {
    user_id: USER.id,
    name: DRAFT.fullName,
    email: USER.email,
    target_role: DRAFT.targetRole,
    location: DRAFT.location,
    experience_years: DRAFT.experienceYears,
    seniority_target: "mid",
    skills: { primary: DRAFT.skills },
    languages: DRAFT.languages.map((language) => ({ language, level: "not_specified" })),
    location_preferences: [{ type: DRAFT.workMode }],
    positioning: {
      seniority_target: "mid",
      preferences: { work_mode: DRAFT.workMode },
      free_notes: DRAFT.notes,
    },
    ...extra,
  };
}

describe("loadOnboardingGate", () => {
  it("routes a brand-new account to profile collection with a partial draft", async () => {
    const partial = { name: "Persona Esempio", skills: ["TypeScript"] };
    const { client } = fakeClient({ profile: { data: partial, error: null } });
    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toEqual({
      phase: "required",
      account: { displayName: "Persona Esempio" },
      initialDraft: {
        fullName: "Persona Esempio",
        targetRole: "",
        location: "",
        experienceYears: 0,
        skills: ["TypeScript"],
        languages: [],
        workMode: "flexible",
        notes: "",
      },
      runtime: { status: "collecting", stage: "profile" },
    });
  });

  it("does not treat a profile or profile milestone as a completed runtime", async () => {
    const { client } = fakeClient({
      milestones: { data: { profile_configured_at: "2026-01-01T00:00:00Z" }, error: null },
      profile: { data: savedProfile(), error: null },
    });
    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toMatchObject({
      phase: "required",
      runtime: { status: "collecting", stage: "host" },
    });
  });

  it("admits an established account only with a ready profile and first team run", async () => {
    const { client } = fakeClient({
      milestones: { data: { first_team_run_at: "2026-01-01T00:00:00Z" }, error: null },
      profile: { data: savedProfile(), error: null },
    });
    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toEqual({ phase: "ready" });
  });

  it("does not silently bypass onboarding when state cannot be read", async () => {
    const { client } = fakeClient({
      milestones: { data: null, error: { message: "offline" } },
      profile: { data: null, error: { message: "offline" } },
    });
    await expect(loadOnboardingGate(client, USER, markerStore())).resolves.toMatchObject({ phase: "error" });
  });

  it("accepts only the final account-scoped subscription marker", async () => {
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

describe("profile persistence and final gate", () => {
  it("writes the canonical profile and independently verifies it without marking completion", async () => {
    const { client, calls } = fakeClient({ reread: { data: savedProfile(), error: null } });
    await expect(saveOnboardingProfile(client, USER, DRAFT)).resolves.toEqual(DRAFT);

    const write = calls.find((call) => call.op === "upsert");
    expect(write?.value).toMatchObject({
      user_id: USER.id,
      name: DRAFT.fullName,
      email: USER.email,
      skills: { primary: DRAFT.skills },
      job_titles: [DRAFT.targetRole],
      location_preferences: [{ type: "hybrid" }],
      positioning: { seniority_target: "mid", preferences: { work_mode: "hybrid" } },
    });
    expect(calls.filter((call) => call.op === "maybeSingle")).toHaveLength(1);
  });

  it("rejects a profile when the independent read cannot prove the write", async () => {
    const { client } = fakeClient({
      reread: { data: savedProfile({ target_role: "Different role" }), error: null },
    });
    await expect(saveOnboardingProfile(client, USER, DRAFT)).rejects.toEqual(
      new OnboardingSaveError("profile-verify-failed"),
    );
  });

  it("writes and re-reads the marker only after every runtime fact and direct chat are true", () => {
    const store = markerStore();
    const incomplete = { ...READY_RUNTIME, directChatReady: false };
    expect(isOnboardingRuntimeReady(incomplete)).toBe(false);
    expect(() => markOnboardingReady(USER.id, incomplete, store)).toThrowError(
      new OnboardingSaveError("runtime-not-ready"),
    );
    expect(store.values.size).toBe(0);

    expect(isOnboardingRuntimeReady(READY_RUNTIME)).toBe(true);
    markOnboardingReady(USER.id, READY_RUNTIME, store);
    expect([...store.values.values()]).toEqual(["subscription-v1"]);
  });

  it("does not report ready when the chat fact is absent at runtime", () => {
    const withoutChat = { ...READY_RUNTIME } as Partial<OnboardingRuntimeSnapshot>;
    delete withoutChat.directChatReady;
    expect(isOnboardingRuntimeReady(withoutChat as OnboardingRuntimeSnapshot)).toBe(false);
    expect(runtimeStateFromSnapshot({ ...READY_RUNTIME, directChatReady: false })).toEqual({
      status: "failed",
      stage: "assistant",
      message: "La chat diretta non è ancora raggiungibile.",
    });
  });
});

describe("isOnboardingProfileReady", () => {
  it("requires the fields that unlock the current profile gate", () => {
    expect(isOnboardingProfileReady(savedProfile())).toBe(true);
    expect(isOnboardingProfileReady(savedProfile({ email: null }))).toBe(false);
    expect(isOnboardingProfileReady(savedProfile({ skills: { primary: ["one"] } }))).toBe(false);
  });
});
