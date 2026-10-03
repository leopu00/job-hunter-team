import { invoke, isTauri } from "@tauri-apps/api/core";

let transitions: Promise<void> = Promise.resolve();

export interface DesktopLocalProfile { profileId: string }

function desktopOnly(): never { throw { code: "desktop_only" }; }

function serialize(operation: () => Promise<void>): Promise<void> {
  const current = transitions.then(operation, operation);
  transitions = current.catch(() => undefined);
  return current;
}

/** Asks the backend to derive and establish scope from its authenticated session. */
export async function activateDesktopAccountScope(): Promise<void> {
  if (!isTauri()) desktopOnly();
  await serialize(async () => {
    await invoke("runtime_account_scope_set");
  });
}

/** Creates a backend-owned local identity without sending UI profile data. */
export async function createDesktopLocalProfile(): Promise<DesktopLocalProfile> {
  if (!isTauri()) desktopOnly();
  let profile!: DesktopLocalProfile;
  await serialize(async () => {
    profile = await invoke<DesktopLocalProfile>("runtime_local_profile_create");
  });
  return profile;
}

/** Activates only a capability that the backend previously issued and persisted. */
export async function activateDesktopLocalScope(profileId: string): Promise<void> {
  if (!isTauri()) desktopOnly();
  await serialize(async () => {
    await invoke("runtime_account_scope_set_local", { profileId });
  });
}

/** Atomically closes scoped resources and clears the backend ownership boundary. */
export async function clearDesktopAccountScope(): Promise<void> {
  if (!isTauri()) desktopOnly();
  await serialize(async () => {
    await invoke("runtime_account_scope_reset");
  });
}

/** DEV/test-only native reset; release builds reject it before filesystem access. */
export async function resetDesktopPlaygroundLocalScope(profileId: string): Promise<void> {
  if (!isTauri()) desktopOnly();
  await serialize(async () => {
    await invoke("runtime_playground_local_reset", { profileId });
  });
}

/** DEV/test-only recovery for an orphaned local owner; accepts no renderer identity. */
export async function recoverDesktopPlaygroundLocalOrphan(): Promise<boolean> {
  if (!isTauri()) desktopOnly();
  let recovered = false;
  await serialize(async () => {
    recovered = await invoke<boolean>("runtime_playground_local_orphan_recover");
  });
  return recovered;
}
