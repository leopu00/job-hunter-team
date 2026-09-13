import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Il loop di polling di `jht cloud daemon` e' il ramo dei pairing SENZA
// credenziali Realtime. Dal 2026-08-24 (c64a9d7569) leggeva `rendezvousState`
// fuori dal blocco che lo dichiarava: ReferenceError al primo giro, exit 1, e
// il bridge-watchdog in produzione lo rilanciava fino al FLAP CAP. Nessun test
// lo eseguiva: il contratto realtime-daemon guarda il sorgente e il ramo
// Realtime, questo invece lancia il processo vero e lo lascia girare.
const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");
const sandboxes: string[] = [];

afterEach(() => {
  for (const root of sandboxes.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function sandbox({ weeklyHalt }: { weeklyHalt: boolean }) {
  const home = mkdtempSync(path.join(tmpdir(), "jht-cloud-daemon-poll-"));
  sandboxes.push(home);
  // Abilitato ma senza supabase_url/refresh token: realtimeSyncEnabled() e'
  // false e il daemon prende il loop di polling. La porta 9 rifiuta subito,
  // cosi' ogni lettura remota fallisce in fretta e il giro arriva in fondo.
  writeFileSync(
    path.join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      token: "jht_sync_synthetic_polling_loop_test",
      base_url: "http://127.0.0.1:9",
    }),
  );
  if (weeklyHalt) writeFileSync(path.join(home, ".weekly-halt.flag"), "halt");
  return home;
}

function runDaemonThenStop(home: string, aliveForMs: number) {
  return new Promise<{
    code: number | null;
    aliveAtStop: boolean;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(process.execPath, [JHT_BIN, "cloud", "daemon"], {
      env: {
        ...process.env,
        JHT_HOME: home,
        JHT_DB: path.join(home, "jobs.db"),
        JHT_REALTIME_SYNC: "0",
        JHT_SYNC_CHECK_SEC: "1",
        JHT_RENDEZVOUS_READ_TIMEOUT_MS: "1000",
        NO_COLOR: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    let aliveAtStop = false;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      aliveAtStop = child.exitCode === null && child.signalCode === null;
      child.kill("SIGTERM");
    }, aliveForMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, aliveAtStop, stdout, stderr });
    });
  });
}

describe("cloud daemon — loop di polling senza Realtime", () => {
  it.each([
    ["senza HALT-WEEKLY", false],
    ["con HALT-WEEKLY", true],
  ])(
    "%s sopravvive a piu' giri ed esce pulito su SIGTERM",
    async (_label, weeklyHalt) => {
      // Tre secondi con JHT_SYNC_CHECK_SEC=1: almeno due giri completi,
      // sleep compreso, prima dello stop.
      const result = await runDaemonThenStop(sandbox({ weeklyHalt }), 3_000);
      const output = `${result.stdout}\n${result.stderr}`;

      expect(output).not.toContain("is not defined");
      expect(result.aliveAtStop, output).toBe(true);
      expect(result.code, output).toBe(0);
      expect(result.stdout).toContain("Daemon stopped.");
      if (weeklyHalt) expect(result.stdout).toContain("HALT-WEEKLY active");
    },
    20_000,
  );
});
