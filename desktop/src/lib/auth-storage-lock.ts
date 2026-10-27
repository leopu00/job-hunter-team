/**
 * Whether a query of the cloud client can be answered at all. In the packaged app the session's
 * storage is locked until a Google sign-in (or its restoration) unlocks it, and a local profile never
 * does (it must not touch the Keychain): every query waits on that storage, so against a locked
 * one it would wait for ever, never fail. Where nothing registered a probe (tests, the browser)
 * the session lives in memory and is always readable.
 */
let probe: (() => boolean) | null = null;

export function registerAuthStorageProbe(isUnlocked: () => boolean): void {
  probe = isUnlocked;
}

export function cloudSessionReadable(): boolean {
  return probe === null || probe();
}
