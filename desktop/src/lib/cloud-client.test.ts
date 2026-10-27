import { afterEach, describe, expect, it, vi } from "vitest";

// The pages read the cloud with a client that answers nothing for ever while the session's storage is
// locked (a local profile never unlocks it). Each case gets fresh modules: the probe is module state.
afterEach(() => vi.resetModules());

async function load(probe: (() => boolean) | null) {
  vi.resetModules();
  vi.doMock("./supabase", () => ({ supabase: { id: "real-client" } }));
  const lock = await import("./auth-storage-lock");
  if (probe) lock.registerAuthStorageProbe(probe);
  const { inertSupabase } = await import("../web-shims/server/inert-supabase");
  const { cloudClient } = await import("./cloud-client");
  return { cloudClient, inertSupabase };
}

describe("cloudClient", () => {
  it("is the real client where nothing guards the session (tests, the browser)", async () => {
    const { cloudClient } = await load(null);
    expect(cloudClient()).toEqual({ id: "real-client" });
  });

  it("is the stand-in that answers «no rows» while the session's storage is locked", async () => {
    const { cloudClient, inertSupabase } = await load(() => false);
    expect(cloudClient()).toBe(inertSupabase);
    await expect(cloudClient().from("positions").select("*")).resolves.toMatchObject({ data: null, error: null });
  });

  it("is the real client again once the storage is unlocked", async () => {
    let unlocked = false;
    const { cloudClient, inertSupabase } = await load(() => unlocked);
    expect(cloudClient()).toBe(inertSupabase);
    unlocked = true;
    expect(cloudClient()).toEqual({ id: "real-client" });
  });
});
