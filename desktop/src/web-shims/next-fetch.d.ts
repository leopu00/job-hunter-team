// Types only. web/lib/exchange-rates.ts passes Next's `next: { revalidate }`
// option to fetch. In the desktop webview the browser ignores it; this lets
// tsc accept the web file unchanged.
interface RequestInit {
  next?: { revalidate?: number | false; tags?: string[] };
}
