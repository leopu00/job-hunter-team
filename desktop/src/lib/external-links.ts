import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Locale } from "@/i18n/config";
import { appLocale } from "./app-locale";

/**
 * The external links of the pages shown in the app (the source of a position, the company's website, Glassdoor,
 * the map, the profile), opened in the person's own browser.
 *
 * The webview drops a request for a new window in silence, so a `<a target="_blank">` does nothing in the app.
 * One listener on the document takes the click on a link that leaves the app and hands the address to the native
 * side (src-tauri/src/external_links.rs), which decides what may open. That covers every page, the ones that exist
 * today and the ones to come, without each of them knowing about the app. On the web nobody installs the listener
 * and the links work as they always did.
 */
export const EXTERNAL_LINK_COMMAND = "open_external_url";

/** What a link to the outside looks like to the listener: these are the schemes that would take the window away
 * from the app or be dropped. `mailto:`, `tel:` and `blob:` are left to the system, a same-origin link to the app. */
const INTERCEPTED_PROTOCOLS = new Set(["http:", "https:", "ftp:", "file:"]);

/** The absolute address of an anchor that leaves the app, or null when the app should leave it alone. */
export function externalHref(anchor: Pick<HTMLAnchorElement, "getAttribute">, base: string, appHref: string): string | null {
  const raw = anchor.getAttribute("href");
  if (!raw) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, base);
  } catch {
    return null;
  }
  if (!INTERCEPTED_PROTOCOLS.has(resolved.protocol)) return null;
  // Scheme and host, not `origin`: a page served by a custom scheme (tauri://localhost) has the origin "null" in
  // the URL parser, and every file: address would be taken for the app's own.
  let app: URL;
  try {
    app = new URL(appHref);
  } catch {
    return resolved.href;
  }
  if (resolved.protocol === app.protocol && resolved.host === app.host) return null;
  return resolved.href;
}

export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    const reply = await invoke<{ ok?: unknown }>(EXTERNAL_LINK_COMMAND, { url });
    return reply?.ok === true;
  } catch {
    return false;
  }
}

export const EXTERNAL_LINK_TEXT: Record<Locale, string> = {
  it: "Non riesco ad aprire questo link nel browser:",
  en: "This link could not be opened in the browser:",
  de: "Dieser Link konnte nicht im Browser geöffnet werden:",
  es: "No se pudo abrir este enlace en el navegador:",
  fr: "Ce lien n’a pas pu être ouvert dans le navigateur :",
  hu: "Ezt a hivatkozást nem sikerült megnyitni a böngészőben:",
  pt: "Não foi possível abrir esta ligação no navegador:",
};

const NOTICE_ID = "jht-external-link-failed";
const NOTICE_MS = 8000;

/** The sentence the person reads when a link did not open: in the app's language, with the address (as text). */
export function showExternalLinkFailure(url: string, doc: Document = document, locale: Locale = appLocale()): void {
  doc.getElementById(NOTICE_ID)?.remove();
  const notice = doc.createElement("div");
  notice.id = NOTICE_ID;
  notice.setAttribute("role", "alert");
  notice.setAttribute("data-testid", NOTICE_ID);
  notice.style.cssText =
    "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;max-width:min(90vw,640px);" +
    "padding:10px 14px;border-radius:8px;font-size:12px;line-height:1.4;overflow-wrap:anywhere;" +
    "background:var(--color-panel,#222);color:var(--color-white,#fff);border:1px solid var(--color-border,#555);";
  notice.textContent = `${EXTERNAL_LINK_TEXT[locale]} ${url.length > 160 ? `${url.slice(0, 160)}…` : url}`;
  doc.body.appendChild(notice);
  const view = doc.defaultView;
  (view ?? window).setTimeout(() => notice.remove(), NOTICE_MS);
}

/**
 * Installs the listener; returns the function that removes it. Does nothing outside the app. It runs after the
 * page's own handlers (the bubble phase of the document), so a link whose handler took the click is left alone.
 */
export function installExternalLinks(
  doc: Document = document,
  open: (url: string) => Promise<boolean> = openExternalUrl,
  fail: (url: string) => void = (url) => showExternalLinkFailure(url, doc),
): () => void {
  if (!isTauri()) return () => {};
  const listener = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    // The left button (click) and the middle one (auxclick); the context menu is the webview's.
    if (event.type === "click" ? event.button !== 0 : event.button !== 1) return;
    const origin = event.target instanceof Element ? event.target : null;
    const anchor = origin?.closest("a[href]");
    if (!anchor) return;
    const url = externalHref(anchor, doc.baseURI, doc.location.href);
    if (!url) return;
    event.preventDefault();
    void open(url).then((opened) => {
      if (!opened) fail(url);
    });
  };
  doc.addEventListener("click", listener);
  doc.addEventListener("auxclick", listener);
  return () => {
    doc.removeEventListener("click", listener);
    doc.removeEventListener("auxclick", listener);
  };
}
