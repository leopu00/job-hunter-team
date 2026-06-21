import type { Metadata } from "next";
import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, isLocalOnlyMode } from "@/lib/workspace";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { readWorkspaceProfile, isProfileComplete } from "@/lib/profile-reader";
import { isLocalRequestFromHeaders } from "@/lib/auth";
import { isDashboardDemoMode } from "@/lib/dashboard-demo";
import Navbar from "@/components/NavbarChrome";
import MainChrome from "@/components/MainChrome";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// [JHT-DASHBOARD-SPLIT] Sezioni di CONTROLLO/CONFIG: vivono solo nell'app
// desktop (scrittura piena + filesystem ~/.jht). Sul deploy cloud (read-only +
// corsia richieste) un'intera pagina di questo tipo non ha senso → redirect a
// /dashboard invece di mostrarla con bottoni che darebbero comunque 403. Guard
// UNICO e centrale qui (no `if` sparsi nei componenti). Le pagine MISTE (team
// monitoring, profilo-vista) NON sono in lista: lì è la singola sezione-controllo
// a sparire, non la pagina. Eccezione: /settings/cloud-sync è gestione token
// sync-infra → resta cloud (vedi [JHT-WEB-READONLY] 1b, è ANCHE sicurezza).
const DESKTOP_ONLY_PREFIXES = [
  "/settings",
  "/credentials",
  "/secrets",
  "/channels",
  "/providers",
  "/integrations",
  "/cron",
  "/backup",
  "/setup",
  "/cli-link",
];

function isDesktopOnlyPath(p: string): boolean {
  if (p.startsWith("/settings/cloud-sync")) return false; // sync-infra resta cloud
  return DESKTOP_ONLY_PREFIXES.some(
    (pre) => p === pre || p.startsWith(pre + "/"),
  );
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const localRequest = isLocalRequestFromHeaders(hdrs);
  const pathname = hdrs.get("x-pathname") ?? "";
  const search = hdrs.get("x-search") ?? "";
  const demoMode = isDashboardDemoMode(search);

  // JHT-LOCAL-NO-API: in modalità local-only (SQLite presente + cloud
  // esplicitamente disabilitato via cloud.json.enabled=false) il web non
  // deve mai parlare con Supabase. Skippiamo l'auth check: tutto il routing
  // passa dal flusso "onboarding locale" sotto. Su Vercel-side è sempre
  // false (no SQLite locale).
  const localOnly = isLocalOnlyMode();

  // [JHT-DASHBOARD-SPLIT] Sul deploy cloud le sezioni di controllo/config non
  // esistono: redirect a /dashboard. Deciso a BUILD (isCloudDeploy), non per
  // richiesta → su locale/desktop è sempre no-op. Prima dell'auth: una pagina
  // desktop-only sul cloud non va mai resa, loggati o meno.
  if (isCloudDeploy() && pathname && isDesktopOnlyPath(pathname)) {
    redirect("/dashboard");
  }

  // Tenta sessione Supabase prima di tutto. Se l'utente è loggato in
  // cloud, prevale sul flusso locale (anche su localhost): mandarlo in
  // /onboarding wizard-PC-locale ha senso solo per chi NON ha account.
  // Vedi docs/internal/2026-05-19-dashboard-routing-cases.md.
  let cloudUser: User | null = null;
  if (isSupabaseConfigured && !demoMode && !localOnly) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    cloudUser = user;
  }

  // Onboarding gate LOCALE: si applica solo se l'utente NON è loggato
  // in cloud. Su localhost+cloud-user-loggato il profilo è su Supabase
  // (candidate_profiles via cloud-sync), il wizard PC-locale è inutile.
  if (
    !cloudUser &&
    localRequest &&
    pathname &&
    !pathname.startsWith("/onboarding") &&
    !demoMode
  ) {
    if (!isProfileComplete(readWorkspaceProfile())) {
      redirect("/onboarding");
    }
  }

  // Auth gate REMOTE: senza sessione e non-localhost → /login.
  // Skippato in local-only mode (impossibile su Vercel comunque, ma
  // esplicito per chiarezza).
  if (isSupabaseConfigured && !cloudUser && !localRequest && !localOnly) {
    const returnTo = pathname ? pathname + search : "";
    if (returnTo && returnTo !== "/") {
      redirect(`/?login=true&returnTo=${encodeURIComponent(returnTo)}`);
    }
    redirect("/?login=true");
  }

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <Navbar user={cloudUser} />
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0">
          <MainChrome>{children}</MainChrome>
        </div>
        {/* Mount point per side panel (es. assistente profilo). Se vuoto,
            non occupa spazio (display:contents). Quando il portal monta
            un pannello qui dentro, diventa flex item della riga sopra
            e il main-area si stringe automaticamente via flex-1. */}
        <div id="protected-side-panel" className="contents" />
      </div>
    </div>
  );
}
