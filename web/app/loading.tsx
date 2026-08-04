import { cookies } from "next/headers";
import { PublicLoadingShell } from "./components/PublicLoadingShell";
import { publicLoadingLocaleFromCookieStore } from "./public-loading.i18n";

export default async function Loading() {
  const cookieStore = await cookies();
  const locale = publicLoadingLocaleFromCookieStore(cookieStore);

  return <PublicLoadingShell locale={locale} />;
}
