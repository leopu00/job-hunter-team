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
  }
}
