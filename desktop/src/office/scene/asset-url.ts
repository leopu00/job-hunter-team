/**
 * The full URL of one of the office's pictures, for Pixi's loader.
 *
 * The manifest names the pictures by root path (/office/floor/wall_main.png).
 * Pixi resolves such a path itself, and its resolution only knows hosts on
 * http(s) and file: in the macOS and Linux app the page is served from
 * tauri://localhost/, and Pixi turns the path into tauri://office/floor/...,
 * a host that is not the app's. The CSP refuses it (connect-src 'self') and
 * every picture is drawn as a plain block. The browser's own URL keeps the
 * host, so the loader gets tauri://localhost/office/floor/... and loads it.
 */
export function assetUrl(src: string, base: string | undefined = globalThis.location?.href): string {
  if (!base) return src;
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}
