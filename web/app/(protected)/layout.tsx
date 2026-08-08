import type { Metadata } from "next";
import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, isLocalOnlyMode } from "@/lib/workspace";
import { isCloudDeploy, isLocalDeploy } from "@/lib/deploy-mode";
import { isLocalRequestFromHeaders } from "@/lib/auth";
import { isDashboardDemoMode } from "@/lib/dashboard-demo";
import { activeDemoPersona } from "@/lib/demo/mode";
import { hasSyncedData } from "@/lib/demo/pairing";
import DemoBanner from "@/app/components/demo/DemoBanner";
import UpdateBanner from "@/app/components/UpdateBanner";
import { getRequestLocale } from "@/lib/request-locale";
import Navbar from "@/app/components/NavbarChrome";
import MainChrome from "@/app/components/MainChrome";

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
  // NB: /settings NON è più desktop-only (20/07): sul cloud la pagina si
  // riduce da sé alle sole sezioni utili (tema + cloud-sync), le tab di
  // config locale restano desktop (vedi settings/page.tsx).
  "/credentials",
  "/secrets",
  "/channels",
  "/providers",
  "/integrations",
  "/cron",
  "/backup",
  "/setup",
  // NB: /cli-link NON è desktop-only. È la pagina di pairing browser (flusso
  // `jht cloud login` da VPS/PC) e per definizione vive sul CLOUD: se la
  // rediriamo a /dashboard il pairing device-flow diventa impossibile in
  // produzione. Reachable su entrambe le modalità (innocua su local).
];

function isDesktopOnlyPath(p: string): boolean {
  if (p.startsWith("/cli-link")) return false; // pairing browser: vive sul cloud
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
  // [JHT-DASHBOARD-SPLIT] Un container LOCAL (desktop webview o VPS via tunnel)
  // non deve MAI forzare il web-login: l'autenticazione è responsabilità
  // dell'app desktop (sezione Account). Le richieste arrivano al container via
  // Docker port-map con header forwarded NON loopback → isLocalRequest può
  // risultare false anche su localhost. Usiamo il deploy mode (deciso a build,
  // 'local' per il container) come segnale affidabile di "contesto locale".
  const localContext = localRequest || isLocalDeploy();
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

  // Tenta sessione Supabase prima di tutto: se l'utente è loggato in
  // cloud, prevale sul flusso locale (anche su localhost).
  // Vedi docs/internal/architecture/2026-05-19-dashboard-routing-cases.md.
  // [JHT-ONBOARDING-IN-GAME 18/07] Il vecchio gate "profilo locale
  // incompleto → /onboarding" non esiste più: la pagina web è stata
  // rimossa e l'onboarding vive nel wizard del videogioco
  // (game/scenes/wizard.tscn). Senza profilo le pagine mostrano i loro
  // empty state.
  let cloudUser: User | null = null;
  if (isSupabaseConfigured && !demoMode && !localOnly) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    cloudUser = user;
  }

  // Auth gate REMOTE: senza sessione e non-locale → /login. Skippato sul
  // container LOCAL (localContext) — lì il login è dell'app desktop, mai una
  // pagina web nella webview — e in local-only mode.
  if (isSupabaseConfigured && !cloudUser && !localContext && !localOnly) {
    const returnTo = pathname ? pathname + search : "";
    if (returnTo && returnTo !== "/") {
      redirect(`/?login=true&returnTo=${encodeURIComponent(returnTo)}`);
    }
    redirect("/?login=true");
  }

  const locale = await getRequestLocale();

  // [JHT-WEB-DEMO] Demo attiva → banda "dati di esempio" su ogni pagina.
  // needsPairing (nessuna posizione reale sincronizzata) accende il
  // promemoria "Collega il tuo team" nello UserMenu. hasSyncedData guarda
  // sempre i dati REALI (head-count con RLS, cache per-request), così il
  // promemoria sparisce da solo al primo sync anche a demo attiva.
  const demoPersona = await activeDemoPersona();
  const needsPairing = cloudUser ? !(await hasSyncedData()) : false;

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <Navbar user={cloudUser} locale={locale} needsPairing={needsPairing} />
      {demoPersona && <DemoBanner persona={demoPersona} />}
      {/* Il box è rimasto indietro rispetto all'ultima release. Qui e non
          in una pagina sola: chi ha una versione vecchia deve incontrare
          la notizia dove già guarda, non andarla a cercare. Si mostra da
          sé solo quando c'è un divario vero (vedi UpdateBanner). */}
      {!demoPersona && <UpdateBanner />}
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
