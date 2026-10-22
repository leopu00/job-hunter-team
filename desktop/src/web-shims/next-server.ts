/**
 * Stand-in for `next/server` in the desktop. The web's route handlers run
 * here as they are, behind the shell's /api bridge: they answer with
 * NextResponse and read a NextRequest. Both are the platform's own Response
 * and Request, with the few extras Next adds.
 */
export class NextResponse<Body = unknown> extends Response {
  /** Same as Next: JSON body, content-type set unless the caller set one. */
  static json<T>(body: T, init?: ResponseInit): NextResponse<T> {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse<T>(JSON.stringify(body), { ...init, headers });
  }

  static redirect(url: string | URL, init?: number | ResponseInit): NextResponse {
    const status = typeof init === "number" ? init : (init?.status ?? 307);
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }

  static next(init?: ResponseInit): NextResponse {
    return new NextResponse(null, init);
  }

  // Keeps the Body parameter used, as in Next's own typing.
  declare readonly __body?: Body;
}

export class NextRequest extends Request {
  readonly nextUrl: URL;

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(this.url);
    // A call from the page to its own routes is same-origin by construction. A webview does not let a script
    // set Origin, Host or Sec-Fetch-Site (a Request built here drops them), and the routes that command the
    // team through the single door want them. So the headers the routes read are a copy that says what is
    // true: this origin, this host, same-origin. They come from the page's location, never from the caller.
    const headers = new Headers(this.headers);
    if (typeof window !== "undefined" && this.nextUrl.origin === window.location.origin) {
      headers.set("origin", window.location.origin);
      headers.set("host", window.location.host);
      headers.set("sec-fetch-site", "same-origin");
    }
    Object.defineProperty(this, "headers", { value: headers, enumerable: true });
  }
}
