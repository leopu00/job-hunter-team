import { invoke, isTauri } from "@tauri-apps/api/core";

let transitions: Promise<void> = Promise.resolve();
let migrationInFlight: { profileId: string; promise: Promise<DesktopProfileMigrationReceipt> } | null = null;

export interface DesktopLocalProfile { profileId: string }
export interface DesktopProfileMigrationReceipt { receiptHash: string }

function desktopOnly(): never { throw { code: "desktop_only" }; }

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const current = transitions.then(operation, operation);
  transitions = current.then(() => undefined, () => undefined);
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

/** Read-only eligibility gate. The authenticated target is derived natively. */
export async function probeDesktopLocalProfileMigration(profileId: string): Promise<boolean> {
  if (!isTauri()) desktopOnly();
  return serialize(() => invoke<boolean>("runtime_local_profile_migration_probe", { profileId }));
}

/** Explicit local-to-authenticated ownership commit; no account identifier crosses IPC. */
export function migrateDesktopLocalProfileToAccount(
  profileId: string,
): Promise<DesktopProfileMigrationReceipt> {
  if (!isTauri()) desktopOnly();
  if (migrationInFlight) {
    return migrationInFlight.profileId === profileId
      ? migrationInFlight.promise
      : Promise.reject({ code: "local_migration_in_progress" });
  }
  let current!: Promise<DesktopProfileMigrationReceipt>;
  current = serialize(() => invoke<DesktopProfileMigrationReceipt>(
    "runtime_local_profile_migrate_to_authenticated",
    { profileId },
  )).then((receipt) => {
    if (!receipt || typeof receipt.receiptHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(receipt.receiptHash)) {
      throw { code: "local_migration_receipt_invalid" };
    }
    return receipt;
  }).finally(() => {
    if (migrationInFlight?.promise === current) migrationInFlight = null;
  });
  migrationInFlight = { profileId, promise: current };
  return current;
}
