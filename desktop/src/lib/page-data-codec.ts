import { pickProfileRead } from "./profile-read-data";
import { positionArrayData, positionWindowData } from "./position-read-data";

/** Never persist the agent panel's action target, tokens, or rendered nodes. */
export function decodePageCopy(topic: string, operation: string, data: unknown): unknown | null {
  if (topic === "profile" && operation === "profile" && data && typeof data === "object") {
    const read = data as { file?: unknown; summaries?: unknown };
    return pickProfileRead({ profile: read.file, summaries: read.summaries });
  }
  if (topic !== "positions") return null;
  if (operation === "window") return positionWindowData(data);
  if (operation === "list" || operation === "facets") return positionArrayData({ items: data });
  return null;
}
