/** Storage mechanics only. Identity and DTO validation belong to the caller. */
export type StoredPageCopy = { key: string; at: number; text: string };
export interface PageCopyStorage {
  get(key: string): Promise<unknown>;
  put(copy: StoredPageCopy): Promise<void>;
}
const DEADLINE_MS = 3000;
const STORE = "copies";
const MAX_ENTRIES = 32;

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let ended = false;
    const request = factory.open("jht-page-data-v1", 1);
    const fail = () => {
      if (ended) return;
      ended = true; clearTimeout(timer); reject(new Error("indexeddb_unavailable"));
    };
    const timer = setTimeout(fail, DEADLINE_MS);
    request.onerror = fail;
    request.onblocked = fail;
    request.onupgradeneeded = () => {
      if (ended) { request.transaction?.abort(); return; }
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => {
      if (ended) { request.result.close(); return; }
      ended = true; clearTimeout(timer); resolve(request.result);
    };
  });
}

function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, start: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let value: T;
    const fail = (reason = new Error("indexeddb_transaction_failed")) => { clearTimeout(timer); reject(reason); };
    const timer = setTimeout(() => {
      try { tx.abort(); } catch { /* The completion event can already be queued. */ }
      fail();
    }, DEADLINE_MS);
    tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
    tx.onabort = tx.onerror = () => fail();
    try { start(tx.objectStore(STORE), (next) => { value = next; }); }
    catch (error) {
      try { tx.abort(); } catch { /* A failed transaction is already closed. */ }
      clearTimeout(timer); reject(error);
    }
  });
}

export class IndexedPageCopies implements PageCopyStorage {
  constructor(private factory = () => globalThis.indexedDB) {}

  async get(key: string): Promise<unknown> {
    const db = await open(this.factory());
    try {
      return await transaction(db, "readonly", (store, result) => {
        const request = store.get(key);
        request.onsuccess = () => result(request.result ?? null);
      });
    } finally { db.close(); }
  }

  async put(copy: StoredPageCopy): Promise<void> {
    const db = await open(this.factory());
    try {
      await transaction<void>(db, "readwrite", (store, result) => {
        const request = store.getAll(undefined, MAX_ENTRIES + 1);
        request.onsuccess = () => {
          const rows = (request.result as StoredPageCopy[]).filter((row) => row.key !== copy.key);
          if (rows.length > MAX_ENTRIES) store.clear();
          else {
            rows.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
            while (rows.length >= MAX_ENTRIES) store.delete(rows.shift()!.key);
          }
          store.put(copy);
          result(undefined);
        };
      });
    } finally { db.close(); }
  }
}
