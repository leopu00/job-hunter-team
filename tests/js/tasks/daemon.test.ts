/** Test unitari — shared/daemon (vitest): install/uninstall scripts, plist, systemd, platform. */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DAEMON_DIR = path.resolve(__dirname, "../../../shared/daemon");
const INSTALL = path.join(DAEMON_DIR, "install.sh");
const UNINSTALL = path.join(DAEMON_DIR, "uninstall.sh");
const installSrc = readFileSync(INSTALL, "utf-8");
const uninstallSrc = readFileSync(UNINSTALL, "utf-8");
const BASH = (() => {
  const envOverride = process.env.JHT_BASH_PATH || process.env.GIT_BASH_PATH;
  if (envOverride) return `"${envOverride}"`;
  if (process.platform !== "win32") return "bash";
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? `"${found}"` : "bash";
})();

/** Quanto diamo a git-bash per rispondere.
 *
 * Era 5000ms, e quel numero era sbagliato — non stretto: sbagliato, perché
 * scelto come se avviare git-bash fosse gratis. Misurato su questo host
 * (Windows, git-bash da "C:\Program Files\Git") lanciando i sette comandi di
 * questo file, tre giri per condizione:
 *
 *   macchina scarica, in sequenza   p50 1204ms   max 2871ms
 *   con la suite intera in parallelo p50 1719ms   max 2489ms
 *   13 spawn concorrenti             p50  749ms   p99 1553ms
 *
 * Cioè il lavoro costa 1–3 secondi contro un budget di 5: un margine di 1,7×
 * per far partire un processo su Windows, con l'antivirus nel percorso. Basta
 * un istante di macchina occupata — e nella suite ci sono cinque altri file
 * che spawnano processi — per sfondarlo. Ecco perché questo file era uno dei
 * due test che rendevano il rosso rumore di fondo: falliva a codice sano, e
 * ripetuto da solo passava.
 *
 * 10s è ~3,4× il massimo misurato. I file fratelli che spawnano processi
 * (provider-autoupdate, provider-model-pin, runtime-upgrade) danno al figlio
 * 60s: qui non serve tanto, perché uno script che si lamenta esce subito e il
 * budget si paga solo quando qualcosa è davvero bloccato.
 *
 * DEVE restare più piccolo di TEST_TIMEOUT_MS: così, quando lo spawn non
 * arriva, il rosso lo spiega questo helper invece del «Test timed out» di
 * vitest, che non dice di quale comando si parla. */
const SPAWN_BUDGET_MS = 10_000;

/** Budget del test, non del processo figlio.
 *
 * Il default di vitest è 5000ms e non era mai stato alzato qui, benché ogni
 * test di parsing avvii un processo: la stessa cifra sbagliata due volte, una
 * per execSync e una per vitest. 15s è la cifra che usano già gli altri file
 * che spawnano (cli-runtime-status, doctor-provider-auth), e lascia spazio
 * anche al worker che resta in attesa del suo turno di CPU. */
const TEST_TIMEOUT_MS = 15_000;

/** Esegue un comando e ne riporta il VERDETTO: codice di uscita e output.
 *
 * `budgetMs` è un parametro solo perché il test che protegge questa funzione
 * possa forzare un timeout senza aspettare dieci secondi.
 *
 * La versione precedente faceva `return { code: e.status ?? 1, out: ... }`, e
 * quel `?? 1` era il difetto: su un timeout dello spawn `e.status` è
 * `undefined`, quindi «bash non ha risposto» diventava indistinguibile da «lo
 * script è uscito con 1». L'output raccolto era vuoto, e a fallire era
 * l'asserzione sul TESTO — cioè il test accusava lo script di non aver
 * stampato il proprio messaggio d'errore. Un rosso che punta il dito nella
 * direzione sbagliata è il modo in cui si impara a ignorare i rossi. */
function run(
  cmd: string,
  budgetMs: number = SPAWN_BUDGET_MS,
): { code: number; out: string } {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: budgetMs,
    });
    return { code: 0, out };
  } catch (e: any) {
    const out = (e.stdout ?? "") + (e.stderr ?? "");
    // Uno script che esce male ha SEMPRE un `status` numerico. Se non c'è, il
    // processo non è arrivato alla fine: timeout, eseguibile mancante, kill.
    // Non è un verdetto sullo script e non va travestito da tale.
    if (typeof e.status !== "number") {
      throw new Error(
        `git-bash non ha risposto entro ${budgetMs}ms ` +
          `(${e.code ?? "errore di spawn"}${e.signal ? `, ${e.signal}` : ""}): ${cmd}\n` +
          `Questo NON è un verdetto dello script: è l'ambiente. ` +
          `Output raccolto prima di interrompere: ${JSON.stringify(out)}`,
      );
    }
    return { code: e.status, out };
  }
}

// --- l'helper stesso ---

describe("run() — distingue l'ambiente dal verdetto", () => {
  it("uno spawn che non arriva non viene raccontato come esito dello script", () => {
    // Con un budget di 1ms il processo non fa in tempo a partire (il minimo
    // misurato su questo host è 425ms), quindi si riproduce esattamente la
    // condizione che rendeva instabile questo file. Prima tornava
    // `{ code: 1, out: "" }` e il rosso diceva «lo script non ha stampato
    // Unknown option»: una frase falsa su un file che nessuno aveva toccato.
    let thrown: Error | null = null;
    try {
      run(`${BASH} "${INSTALL}" --unknown-flag`, 1);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown, "un timeout deve emergere, non essere assorbito").not.toBe(
      null,
    );
    expect(thrown!.message).toContain("git-bash non ha risposto");
    expect(thrown!.message).toContain("NON è un verdetto dello script");
  }, TEST_TIMEOUT_MS);

  it("un'uscita non-zero vera resta un verdetto, con il suo testo", () => {
    // L'altro verso: il caso legittimo non deve diventare un'eccezione, o il
    // test perderebbe proprio ciò che deve provare.
    const r = run(`${BASH} "${INSTALL}" --unknown-flag`);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Unknown option");
  }, TEST_TIMEOUT_MS);
});

// --- install.sh ---

describe("install.sh — argument parsing", () => {
  it("--help esce con codice 0 e mostra usage", () => {
    const r = run(`${BASH} "${INSTALL}" --help`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--name");
    expect(r.out).toContain("--cmd");
  }, TEST_TIMEOUT_MS);

  it("senza --name esce con errore", () => {
    const r = run(`${BASH} "${INSTALL}" --cmd "echo test"`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--name is required");
  }, TEST_TIMEOUT_MS);

  it("senza --cmd esce con errore", () => {
    const r = run(`${BASH} "${INSTALL}" --name test-svc`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--cmd is required");
  }, TEST_TIMEOUT_MS);

  it("opzione sconosciuta esce con errore", () => {
    const r = run(`${BASH} "${INSTALL}" --unknown-flag`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Unknown option");
  }, TEST_TIMEOUT_MS);
});

describe("install.sh — template plist macOS", () => {
  it("contiene template plist con Label, RunAtLoad, KeepAlive", () => {
    expect(installSrc).toContain("<key>Label</key>");
    expect(installSrc).toContain("<key>RunAtLoad</key>");
    expect(installSrc).toContain("<key>KeepAlive</key>");
    expect(installSrc).toContain("<true/>");
  });

  it("plist usa ProgramArguments con /bin/bash -c", () => {
    expect(installSrc).toContain("<key>ProgramArguments</key>");
    expect(installSrc).toContain("<string>/bin/bash</string>");
    expect(installSrc).toContain("<string>-c</string>");
  });

  it("plist configura StandardOutPath e StandardErrorPath", () => {
    expect(installSrc).toContain("<key>StandardOutPath</key>");
    expect(installSrc).toContain("<key>StandardErrorPath</key>");
  });

  it("plist usa label com.jht.SERVICE_NAME", () => {
    expect(installSrc).toContain('com.jht.${SERVICE_NAME}');
  });

  it("plist include EnvironmentVariables se EXTRA_ENV non vuoto", () => {
    expect(installSrc).toContain("<key>EnvironmentVariables</key>");
    expect(installSrc).toContain("EXTRA_ENV");
  });
});

describe("install.sh — template systemd Linux", () => {
  it("contiene unit systemd con sezioni Unit/Service/Install", () => {
    expect(installSrc).toContain("[Unit]");
    expect(installSrc).toContain("[Service]");
    expect(installSrc).toContain("[Install]");
  });

  it("systemd usa Restart=always e RestartSec", () => {
    expect(installSrc).toContain("Restart=always");
    expect(installSrc).toContain("RestartSec=5");
  });

  it("systemd dipende da network-online.target", () => {
    expect(installSrc).toContain("After=network-online.target");
    expect(installSrc).toContain("Wants=network-online.target");
  });

  it("systemd WantedBy=default.target per servizio utente", () => {
    expect(installSrc).toContain("WantedBy=default.target");
  });
});

describe("install.sh — platform detection", () => {
  it("dispatch per Darwin e Linux con fallback errore", () => {
    expect(installSrc).toContain('Darwin) install_macos');
    expect(installSrc).toContain('Linux)  install_linux');
    expect(installSrc).toContain("Unsupported operating system");
  });
});

// --- uninstall.sh ---

describe("uninstall.sh — argument parsing", () => {
  it("--help esce con codice 0 e mostra usage", () => {
    const r = run(`${BASH} "${UNINSTALL}" --help`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--name");
    expect(r.out).toContain("--purge-logs");
  }, TEST_TIMEOUT_MS);

  it("senza --name esce con errore", () => {
    const r = run(`${BASH} "${UNINSTALL}"`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--name is required");
  }, TEST_TIMEOUT_MS);

  it("opzione sconosciuta esce con errore", () => {
    const r = run(`${BASH} "${UNINSTALL}" --bad`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Unknown option");
  }, TEST_TIMEOUT_MS);
});

describe("uninstall.sh — struttura e pulizia", () => {
  it("dispatch per Darwin e Linux con fallback errore", () => {
    expect(uninstallSrc).toContain('Darwin) uninstall_macos');
    expect(uninstallSrc).toContain('Linux)  uninstall_linux');
    expect(uninstallSrc).toContain("Unsupported operating system");
  });

  it("macOS sposta plist nel Cestino come fallback sicuro", () => {
    expect(uninstallSrc).toContain(".Trash");
    expect(uninstallSrc).toContain('mv "$plist_path"');
  });

  it("Linux esegue daemon-reload dopo rimozione unit", () => {
    expect(uninstallSrc).toContain("systemctl --user daemon-reload");
  });

  it("--purge-logs elimina i file .log e .err.log", () => {
    expect(uninstallSrc).toContain("PURGE_LOGS");
    expect(uninstallSrc).toContain("${SERVICE_NAME}.log");
    expect(uninstallSrc).toContain("${SERVICE_NAME}.err.log");
  });

  it("entrambi gli script usano set -euo pipefail", () => {
    expect(installSrc).toContain("set -euo pipefail");
    expect(uninstallSrc).toContain("set -euo pipefail");
  });
});
