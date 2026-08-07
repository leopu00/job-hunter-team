import { after } from "next/server";
import {
  createDownloadClick,
  DOWNLOAD_TARGETS,
  isDownloadSlug,
  type DownloadClick,
} from "@/lib/download-funnel";
import { recordDownloadClick } from "@/lib/download-clicks";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };
type RedirectDependencies = {
  schedule: (task: () => void | Promise<void>) => void;
  record: (event: DownloadClick) => Promise<void>;
  now: () => Date;
  logFailure: () => void;
};

const DEFAULT_DEPENDENCIES: RedirectDependencies = {
  schedule: after,
  record: recordDownloadClick,
  now: () => new Date(),
  // Fixed message by design: never log the request, raw query or DB error.
  logFailure: () =>
    console.error("[download-funnel] aggregate increment failed"),
};

const RESPONSE_HEADERS = { "Cache-Control": "no-store" } as const;

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

  const event = createDownloadClick(
    slug,
    new URL(request.url).searchParams,
    dependencies.now(),
  );
  const response = new Response(null, {
    status: 302,
    headers: {
      ...RESPONSE_HEADERS,
      Location: DOWNLOAD_TARGETS[slug],
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

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  return handleDownloadRedirect(request, slug);
}

export async function HEAD(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  return handleDownloadRedirect(request, slug);
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
