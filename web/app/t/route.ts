import {
  handleLandingRedirect,
  landingMethodNotAllowed,
} from "@/lib/landing-redirect";

export const dynamic = "force-dynamic";

// TikTok. Route handler dedicato, non middleware: vedi `landing-redirect.ts`.
export function GET(request: Request) {
  return handleLandingRedirect(request, "t");
}

export function HEAD(request: Request) {
  return handleLandingRedirect(request, "t");
}

export const POST = landingMethodNotAllowed;
export const PUT = landingMethodNotAllowed;
export const PATCH = landingMethodNotAllowed;
export const DELETE = landingMethodNotAllowed;
export const OPTIONS = landingMethodNotAllowed;
