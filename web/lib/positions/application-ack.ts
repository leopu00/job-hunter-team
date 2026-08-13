export type ApplicationWriteAck = {
  source?: "local" | "cloud";
  cloud_synced?: boolean | null;
};

/** A 2xx response is not enough: local-first must have a confirmed mirror. */
export function applicationAckAccepted(
  saved: ApplicationWriteAck | null | undefined,
): boolean {
  if (!saved || (saved.source !== "local" && saved.source !== "cloud"))
    return false;
  if (saved.source === "cloud") return saved.cloud_synced === true;
  return saved.cloud_synced === true || saved.cloud_synced === null;
}
