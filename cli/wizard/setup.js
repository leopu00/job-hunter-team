/**
 * JHT Setup Wizard — Main orchestration
 *
 * Flusso: prerequisiti → provider AI → auth (SecretRef) → modello →
 *         Telegram → health check → salva config.
 *
 * I path JHT sono fissi (~/.jht, ~/Documents/Job Hunter Team) e non
 * chiesti all'utente.
 *
 * Pattern copiato da OpenClaw (openclaw/src/wizard/setup.ts).
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  AI_PROVIDERS,
  readConfigFileSnapshot,
  validateApiKey,
  summarizeExistingConfig,
} from './setup-helpers.js';
import {
  promptTelegram,
  promptTelegramRequired,
  promptSubscription,
  assembleAndSaveConfig,
  showSummary,
} from './setup-steps.js';
import { formatSecretForConfig } from './secret-ref.js';
import { checkPrerequisites, runHealthCheck } from './setup-checks.js';

// Mappa provider scelto nel wizard → ID accettato da `providers update`
// (i providers.js usa "claude" / "codex" / "kimi" come keys).
const PROVIDER_UPDATE_ID = {
  claude: 'claude',
  openai: 'codex',
  kimi: 'kimi',
};

// Eseguibile del CLI provider per OAuth login. Tutti partono con un comando
// che, al primo run senza credenziali, mostra il device-flow URL.
const PROVIDER_OAUTH_CMD = {
  claude: 'claude',
  openai: 'codex',
  kimi: 'kimi',
};

/**
 * Esegue un sub-comando JHT (lo stesso CLI Node, gia' in /app/cli/bin/jht.js)
 * con stdio inherited. Ritorna true se exit code = 0.
 */
function runJhtSubcommand(args, label) {
  const entry = process.env.JHT_NODE_ENTRY || '/app/cli/bin/jht.js';
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[setup] ${label} fallito (exit ${result.status})`);
    return false;
  }
  return true;
}

/**
 * Esegue il binario provider (es. `claude`) con stdio inherited per OAuth
 * device-flow. Resta finche' l'utente non esce (Ctrl+C o /quit).
 */
function runProviderOauth(cmdName) {
  const result = spawnSync(cmdName, [], {
    stdio: 'inherit',
    env: process.env,
  });
  // Exit code variabile: claude 2.x esce 0 su /quit, !=0 su Ctrl+C.
  // Non blocchiamo il wizard sul exit code.
  return result.error ? false : true;
}

/**
 * Path dove i CLI provider salvano le credenziali OAuth dentro al
 * container. Il polling controlla esistenza + mtime per detectare un
 * login completato dopo l'inizio dell'attesa.
 */
const PROVIDER_CRED_PATHS = {
  claude: ['/jht_home/.claude/.credentials.json', '/home/jht/.claude/.credentials.json'],
  codex:  ['/jht_home/.codex/.credentials.json',  '/home/jht/.codex/.credentials.json'],
  kimi:   ['/jht_home/.config/kimi-cli/credentials.json', '/home/jht/.config/kimi-cli/credentials.json'],
};

/**
 * Polling: aspetta che il file credentials di `cmdName` venga creato o
 * aggiornato dopo `startEpochSec`. Ritorna il path trovato o null in
 * timeout. Sleep 3s tra check, max `timeoutMs`.
 */
async function waitForOauthCredentials(cmdName, startEpochSec, timeoutMs) {
  const candidates = PROVIDER_CRED_PATHS[cmdName] || [];
  if (candidates.length === 0) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of candidates) {
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs / 1000 >= startEpochSec - 1) return p;
      } catch { /* ENOENT */ }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

/**
 * Esegue il setup wizard JHT.
 * @param {import('./prompts.js').WizardPrompter} prompter
 */
export async function runSetupWizard(prompter) {
  await prompter.intro('Job Hunter Team — Setup');

  // --- Step 1: Prerequisiti ---
  const prereqOk = await checkPrerequisites(prompter);
  if (!prereqOk) {
    await prompter.outro('Setup annullato — prerequisiti mancanti.');
    return;
  }

  // --- Config snapshot ---
  const snapshot = readConfigFileSnapshot();
  let baseConfig = snapshot.exists && snapshot.config ? snapshot.config : {};

  if (snapshot.exists && !snapshot.config) {
    await prompter.note(
      'Il file config esiste ma non e\' valido JSON.\nVerra\' ricreato da zero.',
      'Config corrotta',
    );
    baseConfig = {};
  }

  // Modalita' di setup: sempre "quickstart". Il path "advanced" chiedeva
  // dettagli (secret-mode, session token) che non servono per la beta.
  const flow = 'quickstart';

  // --- Config esistente ---
  if (snapshot.exists && snapshot.config) {
    await prompter.note(summarizeExistingConfig(baseConfig), 'Config esistente');
    const action = await prompter.select({
      message: 'Gestione config',
      options: [
        { value: 'keep', label: 'Mantieni valori esistenti' },
        { value: 'modify', label: 'Aggiorna valori' },
        { value: 'reset', label: 'Ricomincia da zero' },
      ],
    });
    if (action === 'keep') {
      await prompter.outro('Configurazione mantenuta. Nessuna modifica.');
      return;
    }
    if (action === 'reset') baseConfig = {};
  }

  // --- Step 2: Provider AI (l'unica scelta tecnica vera del wizard) ---
  const providerChoice = await prompter.select({
    message: 'Provider AI',
    options: AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label, hint: p.hint })),
    initialValue: baseConfig.active_provider || 'claude',
  });
  const selectedProvider = AI_PROVIDERS.find((p) => p.value === providerChoice);

  // --- Auth: solo subscription, nessun input richiesto ---
  // ADR-0004: solo subscription. L'autenticazione VERA (OAuth device flow)
  // viene fatta dal CLI provider (claude/codex/kimi) in uno step successivo
  // del wizard. Qui non chiediamo niente: niente email, niente token, niente
  // browser.
  const authMethod = 'subscription';
  const apiKeySecret = undefined;
  const subscriptionConfig = undefined;

  // Modello: hardcoded al primo della lista del provider scelto. Il valore
  // serve come "default globale" del config ma OGNI agente usa il suo
  // modello (definito nel prompt agente). L'utente non deve scegliere qui.
  const model = baseConfig.providers?.[providerChoice]?.model
    || selectedProvider.models[0].value;

  // Telegram: chiesto inline solo se VPS (vedi step post-config).
  // Su locale, la dashboard del browser e' raggiungibile e Telegram
  // diventa opzionale → si configura dopo con `jht config`.
  let telegramChannel = baseConfig.channels?.telegram || undefined;

  // --- Salva e riepilogo ---
  await assembleAndSaveConfig(prompter, {
    providerChoice, authMethod, apiKey: apiKeySecret, subscriptionConfig, model,
    telegramChannel, baseProviders: baseConfig.providers || {},
  });

  await showSummary(prompter, {
    selectedProvider, authMethod, apiKeySecret, subscriptionConfig,
    model, telegramChannel,
  });

  // ────────────────────────────────────────────────────────────────────────
  // POST-CONFIG: providers update + OAuth login + team start
  // Tutti opzionali (l'utente puo' rispondere "no" e farli a mano dopo) ma
  // proposti di default per arrivare a "team che gira" in un solo wizard.
  // ────────────────────────────────────────────────────────────────────────

  // --- Step 6: install/update CLI provider (sempre, senza chiedere) ---
  const updateProviderId = PROVIDER_UPDATE_ID[providerChoice];
  if (updateProviderId) {
    console.log('');
    console.log(`Installo il CLI di ${selectedProvider.label}...`);
    const ok = runJhtSubcommand(['providers', 'update', updateProviderId], 'providers update');
    if (!ok) {
      const cont = await prompter.confirm({
        message: 'Installazione CLI fallita. Vuoi salvare comunque la config e gestirla a mano?',
        initialValue: false,
      });
      if (!cont) {
        await prompter.outro('Setup interrotto. Riprova con: jht setup');
        return;
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP VPS-ONLY: cloud pairing + Telegram OBBLIGATORI
  //
  // Su VPS (host detectato come "vps" da host-setup.sh) il tester non avra'
  // accesso SSH dopo il setup. Userà SOLO browser dashboard + Telegram. Quindi:
  //   - cloud login OBBLIGATORIO  → linka VPS ↔ account web del tester
  //   - bot Telegram OBBLIGATORIO → unica via di interazione mobile
  // ────────────────────────────────────────────────────────────────────────
  const isVps = (process.env.JHT_HOST_TYPE || '').toLowerCase() === 'vps';

  if (isVps) {
    // --- Cloud pairing ---
    await prompter.note(
      'Il tester usera\' SOLO browser + Telegram (no SSH).\n' +
      'Devi prima collegare questa VPS al suo account jobhunterteam.ai\n' +
      'tramite il device flow.\n\n' +
      'Tra poco vedrai un URL e un codice — apri l\'URL nel browser del\n' +
      'tester (loggato col suo account), digita il codice, conferma.\n' +
      'Quando il pairing e\' confermato, il wizard prosegue da solo.',
      'Pairing cloud (obbligatorio)',
    );
    const cloudOk = runJhtSubcommand(['cloud', 'login'], 'cloud login');
    if (!cloudOk) {
      await prompter.outro(
        'Pairing cloud fallito. Risolvi il problema (deploy web?) e rilancia: jht setup',
      );
      return;
    }

    // --- Telegram bot obbligatorio ---
    telegramChannel = await promptTelegramRequired(prompter, baseConfig.channels);

    // Aggiorno config sul disco con il telegram appena configurato.
    await assembleAndSaveConfig(prompter, {
      providerChoice, authMethod, apiKey: apiKeySecret, subscriptionConfig, model,
      telegramChannel, baseProviders: baseConfig.providers || {},
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // STEP 7: OAuth login (BLOCCANTE — wizard polla finche' rileva il login)
  // ────────────────────────────────────────────────────────────────────────
  const oauthCmd = PROVIDER_OAUTH_CMD[providerChoice];
  const startTs = Date.now() / 1000;
  await prompter.note(
    `Adesso apri un altro terminale sul tuo computer, fai SSH al VPS\n` +
    `(stesso comando ssh che hai usato all'inizio), e lancia:\n\n` +
    `      jht oauth-login\n\n` +
    `Si apre la TUI di ${oauthCmd}:\n` +
    `  1. apri l'URL stampato nel browser sul tuo computer\n` +
    `  2. fai login con il tuo account ${selectedProvider.label}\n` +
    `  3. incolla il codice e quando vedi "authenticated" esci con /quit\n\n` +
    `Sto monitorando il filesystem: appena rilevo le credenziali\n` +
    `proseguo da solo. Niente da premere qui.`,
    `Login ${selectedProvider.label} (in altro terminale)`,
  );

  const credSpinner = prompter.progress(`In attesa del login ${oauthCmd}...`);
  const credPath = await waitForOauthCredentials(oauthCmd, startTs, 30 * 60 * 1000);
  if (!credPath) {
    credSpinner.stop('Timeout (30 min). Login non rilevato.');
    await prompter.outro(
      'Login non completato. Quando sei pronto rilancia: jht setup',
    );
    return;
  }
  credSpinner.stop(`Login ${oauthCmd} rilevato (${credPath})`);

  // ────────────────────────────────────────────────────────────────────────
  // STEP 8: avvia il team automatically (no prompt)
  // ────────────────────────────────────────────────────────────────────────
  console.log('');
  console.log('Avvio il team (Sentinella + Bridge + Capitano)...');
  const startOk = runJhtSubcommand(['team', 'start'], 'team start');
  if (!startOk) {
    await prompter.outro(
      'Avvio team fallito. Vedi log sopra. Riprova: jht team start',
    );
    return;
  }

  await prompter.outro(
    'Tutto pronto! Il team sta lavorando.\n' +
    '  Status:  jht team status\n' +
    '  Logs:    jht logs --tail 30\n' +
    '  Stop:    jht team stop --all',
  );
}
