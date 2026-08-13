export type ApplicationWriteAck = {
  source?: "local" | "cloud";
  cloud_synced?: boolean | null;
};

/** A 2xx response is not enough: local-first must have a confirmed mirror. */
export function applicationAckAccepted(
  saved: ApplicationWriteAck | null | undefined,
): boolean {
  return Boolean(
    saved && !(saved.source === "local" && saved.cloud_synced === false),
  );
}
