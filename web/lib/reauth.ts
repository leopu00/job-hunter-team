import { createClient } from "@/lib/supabase/client";
import {
  reauthCallbackUrl,
  reauthProviderOf,
  saveReauthIntent,
  userIdOf,
  type ReauthIntent,
  type ReauthResult,
} from "@/lib/reauth-intent";

/**
 * «Sign in again» on the website (T63): the door answered `reauth_required`, so a sign-in of the last
 * fifteen minutes is needed. The person is sent through the SAME provider they signed in with, and comes
 * back to this very page, where the intention kept here starts the first step of the confirmation again.
 *
 * The desktop has its own version of this module (the system browser and the loopback of the app): the
 * button imports `@/lib/reauth` and gets whichever the build gives it.
 *
 * The recency itself is decided only by the database, from the new session: this function cannot fake it.
 */
export async function startReauth(
  intent: Pick<ReauthIntent, "kind" | "target">,
): Promise<ReauthResult> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    const provider = reauthProviderOf(data?.user);
    const userId = userIdOf(data?.user);
    if (!provider || !userId) return "unsupported";
    // Written BEFORE leaving, with WHO is signed in: if it cannot be written the sign-in still works, and
    // only the shortcut is lost.
    saveReauthIntent(window.sessionStorage, {
      ...intent,
      userId,
      at: Date.now(),
    });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: reauthCallbackUrl(
          appUrl || window.location.origin,
          window.location,
        ),
        ...(provider === "google"
          ? { queryParams: { prompt: "select_account" } }
          : {}),
      },
    });
    return error ? "failed" : "redirected";
  } catch {
    return "failed";
  }
}

/** Can this person sign in again from here? Only with a provider the site can repeat. */
export async function canReauth(): Promise<boolean> {
  try {
    const { data } = await createClient().auth.getUser();
    return (
      reauthProviderOf(data?.user) !== null && userIdOf(data?.user) !== null
    );
  } catch {
    return false;
  }
}

/** Who is signed in now, for the page that is back from the sign-in; `null` if it cannot be told. */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await createClient().auth.getUser();
    return userIdOf(data?.user);
  } catch {
    return null;
  }
}
