import { after } from "next/server";
import {
  createDownloadClick,
  DOWNLOAD_RELEASE_API,
  isDownloadSlug,
  resolveDownloadTarget,
  type DownloadClick,
} from "@/lib/download-funnel";
import { recordDownloadClick } from "@/lib/download-clicks";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };
type RedirectDependencies = {
  release: unknown;
  schedule: (task: () => void | Promise<void>) => void;
  record: (event: DownloadClick) => Promise<void>;
  now: () => Date;
  logFailure: () => void;
};

const DEFAULT_DEPENDENCIES: RedirectDependencies = {
  release: null,
  schedule: after,
  record: recordDownloadClick,
  now: () => new Date(),
  // Fixed message by design: never log the request, raw query or DB error.
  logFailure: () =>
    console.error("[download-funnel] aggregate increment failed"),
};

const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;
const RELEASE_CACHE_SECONDS = 60;

async function readDownloadRelease(): Promise<unknown> {
  try {
    const response = await fetch(DOWNLOAD_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: RELEASE_CACHE_SECONDS },
    });
    if (!response.ok) {
      console.error(
        `[download-funnel] release assets unavailable (${response.status})`,
      );
      return null;
    }
    return response.json();
  } catch {
    console.error("[download-funnel] release assets unavailable");
    return null;
  }
}

export function handleDownloadRedirect(
  request: Request,
  slug: string,
  dependencies: RedirectDependencies = DEFAULT_DEPENDENCIES,
): Response {
  if (!isDownloadSlug(slug)) {
    return new Response(request.method === "HEAD" ? null : "Not found", {
      status: 404,
      headers: RESPONSE_HEADERS,
    });
  }

  const target = resolveDownloadTarget(slug, dependencies.release);
  if (!target) {
    return new Response(
      request.method === "HEAD" ? null : "Download unavailable",
      {
        status: 503,
        headers: {
          ...RESPONSE_HEADERS,
          "Retry-After": String(RELEASE_CACHE_SECONDS),
        },
      },
    );
  }

  const event = createDownloadClick(
    slug,
    new URL(request.url).searchParams,
    dependencies.now(),
  );
  const response = new Response(null, {
    status: 302,
    headers: {
      ...RESPONSE_HEADERS,
      Location: target,
    },
  });

  try {
    dependencies.schedule(async () => {
      try {
        await dependencies.record(event);
      } catch {
        dependencies.logFailure();
      }
    });
  } catch {
    // Scheduling is measurement infrastructure too: never let it block the
    // download response, and do not expose the event or scheduling error.
    dependencies.logFailure();
  }

  return response;
}

async function handleRoute(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const release = isDownloadSlug(slug) ? await readDownloadRelease() : null;
  return handleDownloadRedirect(request, slug, {
    ...DEFAULT_DEPENDENCIES,
    release,
  });
}

export async function GET(request: Request, context: RouteContext) {
  return handleRoute(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
  return handleRoute(request, context);
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { ...RESPONSE_HEADERS, Allow: "GET, HEAD" },
  });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
