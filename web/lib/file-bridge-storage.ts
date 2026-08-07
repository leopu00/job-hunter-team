const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Storage authority for the transient file bridge.
 *
 * Neither a database path nor a client filename is accepted here. Both UUIDs
 * come from an authenticated server-side boundary, and the final object name
 * is constant. This keeps every request inside its owner's namespace even
 * when service_role bypasses RLS.
 */
export function canonicalFileBridgeStoragePath(
  userId: string,
  requestId: string,
): string {
  return `${fileBridgeStoragePrefix(userId, requestId)}/payload`;
}

export function fileBridgeStoragePrefix(
  userId: string,
  requestId: string,
): string {
  if (!UUID_RE.test(userId) || !UUID_RE.test(requestId)) {
    throw new Error("invalid_file_bridge_identity");
  }
  return `${userId.toLowerCase()}/${requestId.toLowerCase()}`;
}

/** Convert one immediate Storage listing entry into an owned object path. */
export function fileBridgeListedObjectPath(
  userId: string,
  requestId: string,
  objectName: unknown,
): string {
  const name = String(objectName ?? "");
  if (
    !name ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    /[\\/\x00-\x1f\x7f]/.test(name)
  ) {
    throw new Error("invalid_file_bridge_object_name");
  }
  return `${fileBridgeStoragePrefix(userId, requestId)}/${name}`;
}

/** Content-Disposition filename only; never used as a Storage object path. */
export function fileBridgeDownloadName(fileName: unknown): string {
  const normalized = String(fileName ?? "").replaceAll("\\", "/");
  const basename = (normalized.split("/").pop() ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 255);
  return basename || "download";
}
