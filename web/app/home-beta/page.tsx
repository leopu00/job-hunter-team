import JsonLd from "./_components/JsonLd";
import LandingClient from "./_components/LandingClient";

type SearchParams = Promise<{
  login?: string;
  error?: string;
  returnTo?: string;
}>;

function sanitizeReturnTo(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default async function HomeBetaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const wantsLogin = sp.login === "true";
  const authError = sp.error === "auth_failed";
  const returnTo = sanitizeReturnTo(sp.returnTo);

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
