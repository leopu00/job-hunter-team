import {
  handleLandingRedirect,
  landingMethodNotAllowed,
} from "@/lib/landing-redirect";

export const dynamic = "force-dynamic";

// Reddit. Route handler dedicato, non middleware: vedi `landing-redirect.ts`.
export function GET(request: Request) {
  return handleLandingRedirect(request, "r");
}

export function HEAD(request: Request) {
  return handleLandingRedirect(request, "r");
}

export const POST = landingMethodNotAllowed;
export const PUT = landingMethodNotAllowed;
export const PATCH = landingMethodNotAllowed;
export const DELETE = landingMethodNotAllowed;
export const OPTIONS = landingMethodNotAllowed;
