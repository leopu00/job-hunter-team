import JsonLd from "./components/landing/JsonLd";
import LandingClient from "./components/landing/LandingClient";
import LandingHome from "./components/landing/LandingHome";

type SearchParams = Promise<{
  login?: string;
  error?: string;
  returnTo?: string;
}>;

// Solo path interni (es. `/cli-link?code=ABCD-1234`) sono ammessi
// come destinazione post-login: blocca open redirect verso domini
// esterni e protocolli pericolosi (javascript:, data:, ecc.).
function sanitizeReturnTo(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const wantsLogin = sp.login === "true";
  const authError = sp.error === "auth_failed";
  const returnTo = sanitizeReturnTo(sp.returnTo);

  // Login (/?login=true) → vecchio LandingClient, che gestisce l'OAuth.
  // Landing pubblica normale → nuova LandingHome (clean slate, in
  // ricostruzione). Il vecchio sito pubblico resta intatto nei suoi file.
  if (wantsLogin) {
    return (
      <>
        <JsonLd />
        <LandingClient
          wantsLogin={wantsLogin}
          authError={authError}
          returnTo={returnTo}
        />
      </>
    );
  }

  return (
    <>
      <JsonLd />
      <LandingHome />
    </>
  );
}
