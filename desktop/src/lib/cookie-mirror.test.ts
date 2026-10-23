import { describe, expect, it } from "vitest";
import { installCookieMirror } from "./cookie-mirror";

// An engine's document.cookie: `keeps` says whether it stores what is written (WKWebView on tauri://
// does not: the assignment is dropped and the page reads nothing back).
function engine(keeps: boolean): Document {
  const jar = new Map<string, string>();
  class FakeDocument {
    get cookie(): string {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    set cookie(assignment: string) {
      if (!keeps) return;
      const [pair, ...attributes] = assignment.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const gone = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (gone) jar.delete(name);
      else jar.set(name, pair.slice(eq + 1).trim());
    }
  }
  return new FakeDocument() as unknown as Document;
}

function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const COLS = "jht_positions_cols=id%2Ctitle%2Ccompany; path=/; max-age=31536000; SameSite=Lax";

describe("the page cookies on an engine that drops them", () => {
  it("gives back the columns, the currency and the language the page wrote", () => {
    const doc = engine(false);
    installCookieMirror(doc, memory());
    doc.cookie = COLS;
    doc.cookie = "jht_display_currency=USD; path=/; max-age=31536000; samesite=lax";
    doc.cookie = "NEXT_LOCALE=en;path=/;max-age=31536000;SameSite=Lax";
    expect(doc.cookie).toBe("jht_positions_cols=id%2Ctitle%2Ccompany; jht_display_currency=USD; NEXT_LOCALE=en");
  });

  it("keeps them for the next start, because they live in the storage", () => {
    const storage = memory();
    const first = engine(false);
    installCookieMirror(first, storage);
    first.cookie = COLS;
    const second = engine(false);
    installCookieMirror(second, storage);
    expect(second.cookie).toBe("jht_positions_cols=id%2Ctitle%2Ccompany");
  });

  it("forgets a cookie the page deletes (max-age=0, the “reset” of the columns)", () => {
    const doc = engine(false);
    installCookieMirror(doc, memory());
    doc.cookie = COLS;
    doc.cookie = "jht_positions_cols=; path=/; max-age=0; SameSite=Lax";
    expect(doc.cookie).toBe("");
  });

  it("forgets a cookie when its time is up", () => {
    let now = 1_000_000;
    const doc = engine(false);
    installCookieMirror(doc, memory(), () => now);
    doc.cookie = "jht_display_currency=GBP; path=/; max-age=60";
    expect(doc.cookie).toBe("jht_display_currency=GBP");
    now += 61_000;
    expect(doc.cookie).toBe("");
  });

  it("copies only the cookies the pages need, nothing else", () => {
    const storage = memory();
    const doc = engine(false);
    installCookieMirror(doc, storage);
    doc.cookie = "jht_local_token=secret; path=/";
    doc.cookie = "session=abc; path=/";
    expect(doc.cookie).toBe("");
    expect(storage.getItem("jht.cookie-mirror.v1")).toBeNull();
  });
});

describe("the page cookies on an engine that keeps them", () => {
  it("answers the engine's own value, and the copy never overrides it", () => {
    const storage = memory();
    const doc = engine(true);
    installCookieMirror(doc, storage);
    doc.cookie = COLS;
    expect(doc.cookie).toBe("jht_positions_cols=id%2Ctitle%2Ccompany");
    // a value changed behind the copy's back (another tab): the engine's one is what the page reads
    storage.setItem("jht.cookie-mirror.v1", JSON.stringify({ jht_positions_cols: { value: "stale", expires: null } }));
    expect(doc.cookie).toBe("jht_positions_cols=id%2Ctitle%2Ccompany");
  });

  it("leaves the other cookies of the engine as they are", () => {
    const doc = engine(true);
    installCookieMirror(doc, memory());
    doc.cookie = "other=1; path=/";
    doc.cookie = "NEXT_LOCALE=fr; path=/";
    expect(doc.cookie).toBe("other=1; NEXT_LOCALE=fr");
  });
});

describe("without a storage, or with a broken one", () => {
  it("behaves as the engine does", () => {
    const doc = engine(true);
    installCookieMirror(doc, null);
    doc.cookie = COLS;
    expect(doc.cookie).toBe("jht_positions_cols=id%2Ctitle%2Ccompany");
  });

  it("ignores a copy that is not a copy", () => {
    const storage = memory();
    storage.setItem("jht.cookie-mirror.v1", "[1,2,3]");
    const doc = engine(false);
    installCookieMirror(doc, storage);
    expect(doc.cookie).toBe("");
    storage.setItem("jht.cookie-mirror.v1", "{not json");
    expect(doc.cookie).toBe("");
  });

  it("puts the engine's own property back on request", () => {
    const doc = engine(false);
    const restore = installCookieMirror(doc, memory());
    restore();
    doc.cookie = COLS;
    expect(doc.cookie).toBe("");
  });
});
