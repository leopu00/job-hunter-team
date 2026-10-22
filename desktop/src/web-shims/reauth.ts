import { LoginError, signInWithGoogle, supabase } from "../lib/supabase";
import { userIdOf, type ReauthIntent, type ReauthResult } from "@/lib/reauth-intent";

/**
 * Stand-in for web/lib/reauth.ts. The desktop signs in with the system browser and gets the code back on
 * the loopback of the app (the sign-in it already has): when it ends the session of the client is the new
 * one and the page has not been reloaded, so there is no intention to keep: the caller goes on at once.
 *
 * The desktop only signs in with Google, so only a Google account is offered «sign in again». And that
 * sign-in REPLACES the session without asking which account: if it ends with another account than the one
 * that was signed in, nothing resumes (`changed`) and the caller says so.
 */
async function signedInUser(): Promise<{ id: string | null; provider: unknown }> {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user as { app_metadata?: { provider?: unknown } } | null | undefined;
    return { id: userIdOf(data?.user), provider: user?.app_metadata?.provider ?? null };
  } catch {
    return { id: null, provider: null };
  }
}

export async function canReauth(): Promise<boolean> {
  const { id, provider } = await signedInUser();
  return id !== null && provider === "google";
}

export async function currentUserId(): Promise<string | null> {
  return (await signedInUser()).id;
}

export async function startReauth(_intent: Pick<ReauthIntent, "kind" | "target">): Promise<ReauthResult> {
  const before = await signedInUser();
  if (before.id === null || before.provider !== "google") return "unsupported";
  try {
    await signInWithGoogle();
  } catch (error) {
    if (error instanceof LoginError && error.code === "cancelled") return "cancelled";
    return "failed";
  }
  const after = await signedInUser();
  return after.id !== null && after.id === before.id ? "done" : "changed";
}
