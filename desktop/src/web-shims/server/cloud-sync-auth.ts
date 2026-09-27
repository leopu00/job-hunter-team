import { NextResponse } from "next/server";

/**
 * Stand-in for web/lib/cloud-sync/auth.ts. On the web a request with a
 * `jht_sync_…` Bearer token comes from a user's box, and the route gets a
 * service_role client for it. The desktop never takes that path: it has the
 * user's session and no service_role anywhere, so a Bearer request is
 * refused and the web code (web/lib/team-state/auth.ts resolveUser) goes on
 * with the session.
 */
export interface VerifiedToken {
  userId: string;
  tokenId: string;
  name: string;
  admin: never;
}

export type VerifyResult = { ok: true; data: VerifiedToken } | { ok: false; res: NextResponse };

export async function verifyBearerToken(_req: Request): Promise<VerifyResult> {
  return {
    ok: false,
    res: NextResponse.json({ error: "sync tokens are not accepted in the desktop" }, { status: 401 }),
  };
}
