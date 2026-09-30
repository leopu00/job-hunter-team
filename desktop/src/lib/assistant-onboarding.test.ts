import { describe, expect, it } from "vitest";
import {
  assistantOnboardingMessageId,
  AssistantOnboardingStoreError,
  loadAssistantOnboardingState,
  saveAssistantOnboardingState,
  type AssistantOnboardingStore,
} from "./assistant-onboarding";

function memoryStore(): AssistantOnboardingStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("Assistant onboarding account state", () => {
  it("persists, re-reads and isolates a serializable state per account", () => {
    const store = memoryStore();
    saveAssistantOnboardingState(
      "account-a",
      { path: "tour", step: 3, firstMessage: "must-not-be-persisted" } as never,
      store,
    );
    expect(loadAssistantOnboardingState("account-a", store)).toEqual({ path: "tour", step: 3 });
    expect(loadAssistantOnboardingState("account-b", store)).toBeUndefined();
    expect(store.values.get("jht.desktop.assistant-onboarding.account-a"))
      .toBe(JSON.stringify({ path: "tour", step: 3 }));
    store.values.set(
      "jht.desktop.assistant-onboarding.account-b",
      JSON.stringify({ path: "explore", step: 1, simulatedPayload: { ready: true } }),
    );
    expect(loadAssistantOnboardingState("account-b", store)).toEqual({ path: "explore", step: 1 });
  });

  it("fails closed for malformed or unverified storage", () => {
    const store = memoryStore();
    store.values.set("jht.desktop.assistant-onboarding.account-a", "{broken");
    expect(loadAssistantOnboardingState("account-a", store)).toBeUndefined();
    expect(() => saveAssistantOnboardingState(
      "account-a",
      { path: "unknown", step: 1 } as never,
      store,
    )).toThrowError(AssistantOnboardingStoreError);

    const dropping: AssistantOnboardingStore = { getItem: () => null, setItem: () => undefined };
    expect(() => saveAssistantOnboardingState("account-a", { path: "explore", step: 2 }, dropping))
      .toThrowError(AssistantOnboardingStoreError);
  });

  it("creates one stable native de-duplication id per account, state and confirmed message", async () => {
    const state = { path: "tour", step: 4 } as const;
    const first = await assistantOnboardingMessageId("account-a", state, "  Prima domanda  ");
    await expect(assistantOnboardingMessageId("account-a", state, "Prima domanda")).resolves.toBe(first);
    await expect(assistantOnboardingMessageId("account-b", state, "Prima domanda")).resolves.not.toBe(first);
    await expect(assistantOnboardingMessageId("account-a", state, "Domanda diversa")).resolves.not.toBe(first);
    expect(first).toMatch(/^assistant-onboarding-[a-f0-9]{64}$/);
  });
});
