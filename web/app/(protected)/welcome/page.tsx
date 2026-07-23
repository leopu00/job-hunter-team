import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { activeDemoPersona } from "@/lib/demo/mode";
import { hasSyncedData } from "@/lib/demo/pairing";
import WelcomeClient from "./WelcomeClient";

export const dynamic = "force-dynamic";

// [JHT-WEB-DEMO] Wizard di benvenuto per l'utente cloud nuovo (22/07):
// stato del setup → via d'uscita (download / avvio / pairing token) →
// demo interattiva per categoria. Cloud-only: sul deploy locale/desktop
// l'onboarding vive nel wizard del videogioco (game/scenes/wizard.tscn).
// L'auth gate sta nel layout protetto; qui arriva solo un utente loggato.
export default async function WelcomePage() {
  if (!isCloudDeploy()) redirect("/dashboard");
  const [synced, persona, hdrs] = await Promise.all([
    hasSyncedData(),
    activeDemoPersona(),
    headers(),
  ]);
  // ?preview=1: mostra il wizard completo anche a team già collegato —
  // per rivederlo (o provare la demo) senza dover scollegare nulla.
  const preview = (hdrs.get("x-search") ?? "").includes("preview=1");
  return (
    <WelcomeClient hasSynced={synced && !preview} activePersona={persona} />
  );
}
