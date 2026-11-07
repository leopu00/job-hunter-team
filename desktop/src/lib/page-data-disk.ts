import type { PageDataCopy, PageDataIdentityReader, PageDataPersistence, VerifiedPageDataIdentity } from "./page-data-persistence";
import { IndexedPageCopies, type PageCopyStorage } from "./page-data-indexeddb";
import { decodePageCopy } from "./page-data-codec";
import { withReadDeadline } from "./read-deadline";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const error = (code: string) => ({ code });
type Binding = { key: string; topic: string; op: string; epoch: number };

function validIdentity(scope: VerifiedPageDataIdentity): boolean {
  return [scope.accountFingerprint, scope.teamFingerprint].every((part) =>
    typeof part === "string" && part.length > 0 && part.length <= 256 && !/[\u0000-\u001f]/.test(part));
}

export class PageDataDisk implements PageDataPersistence {
  private writes = new Map<string, Promise<boolean>>();
  constructor(private identity: PageDataIdentityReader, private epoch: () => number,
    private storage: PageCopyStorage = new IndexedPageCopies(), private clock = () => Date.now()) {}

  private async binding(key: string): Promise<Binding | null> {
    // In particular, do not open IndexedDB or manufacture a key for a null scope.
    if (this.identity === null) return null;
    const epoch = this.epoch();
    const scope = await withReadDeadline(this.identity(), 3000);
    if (scope === null || this.epoch() !== epoch) return null;
    if (!validIdentity(scope)) throw error("page_data_disk_invalid");
    const parts: unknown = JSON.parse(key);
    if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== epoch
      || typeof parts[1] !== "string" || typeof parts[2] !== "string") throw error("page_data_disk_invalid");
    if (parts[1] === "agents") return null;
    return { key: JSON.stringify([scope.accountFingerprint, scope.teamFingerprint, ...parts.slice(1)]),
      topic: parts[1], op: parts[2], epoch };
  }

  async read(key: string): Promise<PageDataCopy | null> {
    let bound: Binding | null;
    let row: unknown;
    try {
      bound = await this.binding(key);
      if (!bound || this.epoch() !== bound.epoch) return null;
      row = await this.storage.get(bound.key);
    } catch (reason) { throw this.reason(reason, "page_data_disk_read_failed"); }
    if (this.epoch() !== bound.epoch || row === null || row === undefined) return null;
    if (!row || typeof row !== "object") throw error("page_data_disk_invalid");
    const stored = row as { key?: unknown; text?: unknown };
    if (stored.key !== bound.key || typeof stored.text !== "string" || new TextEncoder().encode(stored.text).length > MAX_BYTES)
      throw error("page_data_disk_invalid");
    let copy: { version?: unknown; key?: unknown; at?: unknown; data?: unknown };
    try { copy = JSON.parse(stored.text); } catch { throw error("page_data_disk_invalid"); }
    if (!copy || copy.version !== 1 || copy.key !== bound.key || typeof copy.at !== "number"
      || !Number.isFinite(copy.at) || copy.at <= 0 || copy.at > this.clock()) throw error("page_data_disk_invalid");
    if (this.clock() - copy.at > MAX_AGE_MS) return null;
    const data = decodePageCopy(bound.topic, bound.op, copy.data);
    if (data === null) throw error("page_data_disk_invalid");
    return { data, at: copy.at };
  }

  write(key: string, copy: PageDataCopy, current = () => true): Promise<boolean> {
    // Scope resets change the volatile epoch, not ordering of writes of the same projection.
    let queued: string;
    try { queued = JSON.stringify(JSON.parse(key).slice(1)); }
    catch { return Promise.reject(error("page_data_disk_invalid")); }
    const previous = this.writes.get(queued) ?? Promise.resolve(false);
    const work = previous.catch(() => false).then(() => this.save(key, copy, current));
    this.writes.set(queued, work);
    void work.finally(() => { if (this.writes.get(queued) === work) this.writes.delete(queued); }).catch(() => undefined);
    return work;
  }

  private async save(key: string, copy: PageDataCopy, current: () => boolean): Promise<boolean> {
    try {
      if (!current()) return false;
      const bound = await this.binding(key);
      if (!bound || !current() || this.epoch() !== bound.epoch) return false;
      const data = decodePageCopy(bound.topic, bound.op, copy.data);
      if (data === null || !Number.isFinite(copy.at) || copy.at <= 0 || copy.at > this.clock()) throw error("page_data_disk_invalid");
      const text = JSON.stringify({ version: 1, key: bound.key, at: copy.at, data });
      if (new TextEncoder().encode(text).length > MAX_BYTES) throw error("page_data_disk_write_failed");
      await this.storage.put({ key: bound.key, text, at: copy.at });
      return true;
    } catch (reason) { throw this.reason(reason, "page_data_disk_write_failed"); }
  }

  private reason(reason: unknown, fallback: string): { code: string } {
    const code = reason && typeof reason === "object" && "code" in reason ? reason.code : null;
    return error(typeof code === "string" && ["page_data_disk_invalid", "page_data_disk_read_failed", "page_data_disk_write_failed"].includes(code) ? code : fallback);
  }
}
