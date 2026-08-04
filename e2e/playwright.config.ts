import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// ⚠️ Contro `next dev` usa **localhost**, non `127.0.0.1`.
//
// Il default storico era `127.0.0.1` per un problema di `next start` (dove
// `localhost` poteva risolvere su ::1 mentre il server ascoltava su IPv4). In
// dev quel default costa carissimo: Next rifiuta l'upgrade WebSocket dell'HMR
// quando l'host non è `localhost`, il runtime di sviluppo resta appeso a
// riconnettersi e **React non idrata affatto**. Risultato: le pagine si vedono,
// nessun click funziona, e i test che cliccano falliscono con messaggi che non
// c'entrano nulla (misurato il 2026-07-25: stesso server, stessa build —
// localhost avanza, 127.0.0.1 no).
//
// Se un giorno servisse davvero IPv4 esplicito contro `next start`, passa
// BASE_URL a mano per quella sola esecuzione.
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ── Sessione (opzionale) ────────────────────────────────────────────────
// L'area riservata pretende una sessione Supabase: senza, gli spec che la
// toccano si skippano da soli (vedi e2e/README.md § "State of the suite" —
// misurato 770 passed / 574 skipped il 2026-07-25).
//
// Per sbloccarli serve lo storage state di un **account di test dedicato**:
//
//   npx playwright open --save-storage=auth-state.json http://127.0.0.1:3008
//   # login a mano, poi chiudi la finestra
//   BASE_URL=http://127.0.0.1:3008 npx playwright test
//
// Il file viene raccolto automaticamente se esiste (default `auth-state.json`,
// override con E2E_STORAGE_STATE). È git-ignored: contiene un token di sessione
// vivo, non committarlo mai.
const STORAGE_STATE = process.env.E2E_STORAGE_STATE || "auth-state.json";
const storagePath = path.resolve(__dirname, STORAGE_STATE);
const hasSession = fs.existsSync(storagePath);
const isPublicCi = process.env.CI === "true";

if (hasSession) {
  console.log(
    `[playwright] sessione trovata: ${STORAGE_STATE} → i test dell'area riservata girano`,
  );
} else {
  console.log(
    `[playwright] nessuna sessione (${STORAGE_STATE} assente) → gli spec dell'area riservata si skipperanno. Ricetta: e2e/README.md § Sessione`,
  );
}

// ── Quarantena ──────────────────────────────────────────────────────────
// 75 delle 78 spec storiche testano un sito che non esiste più (pagine
// rimosse, plane locale ritirato, contratti API cambiati). Stanno in
// `tests/quarantine/` e non girano: una suite che "passa" perché salta se
// stessa è peggio di nessuna suite, perché sembra un segnale. Il perché,
// gruppo per gruppo, è in tests/quarantine/README.md.
//
// Per girarle apposta — revisione, recupero di una spec:
//   E2E_INCLUDE_QUARANTINE=1 npx playwright test quarantine/
const INCLUDE_QUARANTINE = process.env.E2E_INCLUDE_QUARANTINE === "1";

export default defineConfig({
  testDir: "./tests",
  testIgnore: INCLUDE_QUARANTINE ? [] : ["**/quarantine/**"],
  timeout: 30_000,
  retries: 1,
  reporter: [["html", { outputFolder: "reports/playwright" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    // Trace, video e report di rete possono serializzare header e storage
    // state. In CI il repository è pubblico: teniamo soltanto screenshot di
    // UI sintetica; localmente restano disponibili gli artefatti diagnostici.
    video: isPublicCi ? "off" : "retain-on-failure",
    // PRIVACY: non salvare screenshot automatici con dati personali
    trace: isPublicCi ? "off" : "on-first-retry",
    ...(hasSession ? { storageState: storagePath } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
