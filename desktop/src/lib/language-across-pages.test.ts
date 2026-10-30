import { afterEach, describe, expect, it, vi } from "vitest";
import { appLocale, chooseAppLocale, explicitLocale } from "./app-locale";
import { installCookieMirror } from "./cookie-mirror";

// The app's first screen (the language) is one page and the dashboard the next, in the same webview. On macOS the
// engine drops the cookies of the app's pages, so the language lives in the mirror kept in the storage: the choice
// made on the first page must be the one the next page reads, even where the mirror already held another language.
function engine(): Document {
  class FakeDocument {
    cookie = "";
    lang = "";
  }
  const doc = new FakeDocument();
  // the engine drops every write and reads nothing back
  Object.defineProperty(doc, "cookie", { configurable: true, get: () => "", set: () => undefined });
  return doc as unknown as Document;
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

/** A page of the app: its own document over the shared storage, with the mirror installed as the entry point does. */
function openPage(storage: Storage) {
  const doc = engine();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("localStorage", storage);
  installCookieMirror(doc, storage);
  return doc;
}

afterEach(() => vi.unstubAllGlobals());

describe("the language chosen on the first page is the one the next page speaks", () => {
  it("English chosen on a machine whose system is Italian: the dashboard reads English", () => {
    const storage = memory();
    openPage(storage);
    expect(explicitLocale()).toBeNull();
    expect(chooseAppLocale("en")).toBe(true);
    openPage(storage); // the next page: a new document, the same storage
    expect(explicitLocale()).toBe("en");
    expect(appLocale()).toBe("en");
  });

  it("a language the mirror already holds is what the app speaks, so there is nothing to ask again", () => {
    const storage = memory();
    storage.setItem("jht.cookie-mirror.v1", JSON.stringify({ NEXT_LOCALE: { value: "it", expires: Date.now() + 86_400_000 } }));
    openPage(storage);
    expect(explicitLocale()).toBe("it");
  });

  it("a choice made over an old one replaces it for every page that comes after", () => {
    const storage = memory();
    storage.setItem("jht.cookie-mirror.v1", JSON.stringify({ NEXT_LOCALE: { value: "it", expires: Date.now() + 86_400_000 } }));
    openPage(storage);
    expect(chooseAppLocale("de")).toBe(true);
    openPage(storage);
    expect(appLocale()).toBe("de");
  });

  it("without the mirror on the first page, the old language wins on the next: why both entry points install it", () => {
    const storage = memory();
    storage.setItem("jht.cookie-mirror.v1", JSON.stringify({ NEXT_LOCALE: { value: "it", expires: Date.now() + 86_400_000 } }));
    const first = engine(); // the first page, with no mirror
    vi.stubGlobal("document", first);
    vi.stubGlobal("localStorage", storage);
    expect(chooseAppLocale("en")).toBe(true); // jht-lang kept it
    openPage(storage); // the dashboard: the mirror hands back the old Italian
    expect(appLocale()).toBe("it");
  });
});
