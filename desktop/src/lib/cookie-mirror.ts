/**
 * The cookies the pages write on their own (the positions' columns, the display currency, the
 * language) are read back by the same pages after `router.refresh()` and at the next start. On macOS
 * the app's pages are served by a custom scheme (tauri://localhost), and WKWebView does not keep the
 * cookies of such a page: the write is dropped, the page reads its defaults again, and a choice the
 * person just made is undone. This keeps a copy of those few cookies in localStorage and gives it
 * back through `document.cookie` when the engine did not keep the cookie itself. Where the engine
 * keeps cookies, its own value always wins and nothing changes.
 */
const MIRRORED = new Set(["NEXT_LOCALE", "jht_positions_cols", "jht_display_currency"]);
const STORAGE_KEY = "jht.cookie-mirror.v1";

type Entry = { value: string; expires: number | null };
type Jar = Record<string, Entry>;

function readJar(storage: Storage | null, now: number): Jar {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const jar: Jar = {};
    for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!MIRRORED.has(name) || !entry || typeof entry !== "object") continue;
      const { value, expires } = entry as { value?: unknown; expires?: unknown };
      if (typeof value !== "string") continue;
      if (typeof expires === "number" && expires <= now) continue;
      jar[name] = { value, expires: typeof expires === "number" ? expires : null };
    }
    return jar;
  } catch {
    return {};
  }
}

function writeJar(storage: Storage | null, jar: Jar): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(jar));
  } catch {
    // No storage: the cookie alone, as before.
  }
}

/** The name, value and expiry a `document.cookie = "..."` assignment sets; null expiry = session. */
function parseAssignment(assignment: string, now: number): { name: string; value: string; expires: number | null; removed: boolean } | null {
  const [pair, ...attributes] = assignment.split(";");
  const eq = pair.indexOf("=");
  if (eq < 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  let expires: number | null = null;
  for (const attribute of attributes) {
    const at = attribute.indexOf("=");
    const key = (at < 0 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
    const given = at < 0 ? "" : attribute.slice(at + 1).trim();
    if (key === "max-age" && /^-?\d+$/.test(given)) {
      expires = now + Number(given) * 1000;
      break; // Max-Age wins over Expires
    }
    if (key === "expires") {
      const when = Date.parse(given);
      if (!Number.isNaN(when)) expires = when;
    }
  }
  return { name, value, expires, removed: expires !== null && expires <= now };
}

function cookieDescriptor(doc: Document): PropertyDescriptor | undefined {
  for (let target: object | null = doc; target; target = Object.getPrototypeOf(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, "cookie");
    if (descriptor) return descriptor;
  }
  return undefined;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Returns the function that puts the engine's own `document.cookie` back (for tests). */
export function installCookieMirror(
  doc: Document = document,
  storage: Storage | null = safeStorage(),
  now: () => number = Date.now,
): () => void {
  const original = cookieDescriptor(doc);
  if (!original?.get || !original.set) return () => undefined;
  const read = original.get;
  const write = original.set;
  Object.defineProperty(doc, "cookie", {
    configurable: true,
    enumerable: original.enumerable,
    get(): string {
      const real = read.call(doc) as string;
      const present = new Set(real.split(";").map((part) => part.slice(0, Math.max(part.indexOf("="), 0)).trim()));
      const kept = Object.entries(readJar(storage, now()))
        .filter(([name]) => !present.has(name))
        .map(([name, { value }]) => `${name}=${value}`);
      return [real, ...kept].filter(Boolean).join("; ");
    },
    set(assignment: string) {
      write.call(doc, assignment);
      const parsed = parseAssignment(String(assignment), now());
      if (!parsed || !MIRRORED.has(parsed.name)) return;
      const jar = readJar(storage, now());
      if (parsed.removed || parsed.value === "") delete jar[parsed.name];
      else jar[parsed.name] = { value: parsed.value, expires: parsed.expires };
      writeJar(storage, jar);
    },
  });
  return () => {
    delete (doc as unknown as Record<string, unknown>).cookie;
  };
}
