import { createContext, useContext } from "react";

/**
 * «Sign out», for a page that is not the navbar. The shell owns what signing out does (it stops the
 * runtime's account scope, then the session); a page gets that same function, never its own.
 */
export const SignOutContext = createContext<(() => Promise<void>) | null>(null);

export function useSignOut(): (() => Promise<void>) | null {
  return useContext(SignOutContext);
}

/** Who is signed in, as the person sees it on their own screen: never sent anywhere, never logged. */
export type AccountIdentity = { kind: "google"; label: string } | { kind: "local"; label: string } | null;

export async function loadAccountIdentity(): Promise<AccountIdentity> {
  const { localIdentitySelected, readLocalProfile } = await import("./local-profile");
  if (localIdentitySelected()) {
    const profile = readLocalProfile();
    if (profile) return { kind: "local", label: profile.displayName };
  }
  try {
    const { supabase } = await import("./supabase");
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    const label = typeof user?.email === "string" && user.email ? user.email : null;
    return label ? { kind: "google", label } : null;
  } catch {
    return null;
  }
}
