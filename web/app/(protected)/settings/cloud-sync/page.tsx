import CloudSyncClient from "./CloudSyncClient";
import CloudTokensClient from "./CloudTokensClient";
import { isCloudDeploy } from "@/lib/deploy-mode";

export const dynamic = "force-dynamic";

// [JHT-DASHBOARD-SPLIT] /settings/cloud-sync ha due volti:
//   - cloud  → gestione token sync-infra (pairing VPS/PC → account). Non tocca
//              il filesystem: funziona su Vercel dove non esiste ~/.jht/jobs.db.
//   - local  → UI di sync locale (push SQLite → cloud) dell'app desktop/VPS.
// Prima renderizzava SEMPRE la versione local, che sul cloud mostrava solo
// "database locale non trovato" e non offriva alcun modo di creare un token →
// pairing da browser impossibile. Split deciso a build via isCloudDeploy().
export default function CloudSyncPage() {
  return isCloudDeploy() ? <CloudTokensClient /> : <CloudSyncClient />;
}
