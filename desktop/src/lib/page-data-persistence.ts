/** A producer must attest BOTH values natively for the currently active scope.
 * No producer exists on this base: T201/T202 must supply it before disk is enabled.
 */
export type VerifiedPageDataIdentity = Readonly<{ accountFingerprint: string; teamFingerprint: string }>;
export type PageDataIdentityReader = (() => Promise<VerifiedPageDataIdentity | null>) | null;
// CHECKPOINT: disk remains off until the native identity contract is available.
export const pageDataIdentityReader: PageDataIdentityReader = null;

export type PageDataCopy = { data: unknown; at: number };
export interface PageDataPersistence {
  read(key: string): Promise<PageDataCopy | null>;
  write(key: string, copy: PageDataCopy, current?: () => boolean): Promise<boolean>;
}
