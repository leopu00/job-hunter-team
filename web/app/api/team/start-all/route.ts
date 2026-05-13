import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { runBash, runScript, toWslPath } from "@/lib/shell";
import { requireAuth } from "@/lib/auth";
import { JHT_CONFIG_PATH } from "@/lib/jht-paths";
import path from "path";

export const dynamic = "force-dynamic";

// Bootstrap minimale del team:
//   - Assistente: prima del resto, cosi' puo' mandare il welcome via
//     Telegram all'utente appena finisce il wizard di setup. Su Desktop
//     l'Assistente viene gia' avviato da Electron → container.js, e in
//     quel caso questo step e' un no-op (sessione gia' attiva, skip).
//     Su VPS headless invece e' qui che parte.
//   - Capitano: il coordinatore che poi spawna gli altri agenti (scaling
//     graduale definito nel suo prompt). start-agent.sh gli invia anche
//     un kick-off message automatico dopo ~15s di boot del CLI. Insieme
//     al Capitano viene spawnato anche sentinel-bridge.py — il servizio
//     deterministico che monitora rate-limit + host e invia [BRIDGE ORDER]
//     al Capitano quando la policy cambia (T0..T4, edge-triggered).
// Gli altri ruoli (Scout, Analista, Scorer, Scrittore, Critico) vengono
// accesi dal Capitano secondo le sue soglie.
async function readSentinellaTickMinutes(): Promise<number> {
  // Tick idle (default 10 min, range 1-60): il bridge usa questo come
  // ceiling a riposo, ma adatta dinamicamente in alto (fino a 1 min)
  // quando status CRITICO / host saturo / team operativo attivo.
  try {
    const raw = await fs.readFile(JHT_CONFIG_PATH, "utf8");
    const cfg = JSON.parse(raw);
    const n = Number(cfg?.sentinella_tick_minutes);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return Math.round(n);
  } catch {
    /* fallback al default */
  }
  return 10;
}

type TeamAgent = {
  role: string;
  session: string;
  instance: string | null;
  env?: Record<string, string>;
  /** Sleep in ms PRIMA di lanciare questo agente (per dare tempo al
   *  predecessore di stabilizzarsi). 0 = parte subito. */
  preDelayMs?: number;
  /** Se true, l'agente non è una sessione tmux (es. bridge background).
   *  Skippa il check has-session. */
  notATmuxSession?: boolean;
};

async function buildTeam(): Promise<TeamAgent[]> {
  const tickMin = await readSentinellaTickMinutes();
  // Sequenza V7 (rivista 2026-05-13, 3 bot Telegram dedicati):
  //   0. ASSISTENTE: per primo, cosi' manda subito il welcome Telegram
  //      (canale primario su VPS headless).
  //   1. TG-BRIDGE: spawna 3 long-poll Bot API (assistente/capitano/mentor)
  //      → tmux corrispondente. Background. No JHT_TG_TARGET_SESSION:
  //      ogni processo lo deriva dal proprio role.
  //   2. SENTINELLA: pronta a ricevere il primo [BRIDGE TICK].
  //   3. BRIDGE (sentinel + pacing): processo Python background.
  //   4. MENTOR: tmux user-facing always-on (riceve `[TG]` dal bridge).
  //   5. CAPITANO: per ULTIMO, monitoring gia' stabile.
  //
  // Pre-delay rivisti per PC lenti:
  //   • tg-bridge:   5s dopo assistente (TUI assistente in boot)
  //   • sentinella:  3s dopo tg-bridge  (CLI boot iniziale)
  //   • bridge:     20s dopo sentinella (CLI boot lento + trust dialog)
  //   • mentor:      3s dopo bridge     (CLI boot user-facing)
  //   • capitano:    5s dopo mentor     (lascia che il primo fetch
  //                                      arrivi prima del kick-off)
  return [
    { role: "assistente", session: "ASSISTENTE", instance: null },
    {
      role: "tg-bridge",
      session: "TG-BRIDGE",
      instance: null,
      preDelayMs: 5000,
      notATmuxSession: true,
      env: {},
    },
    {
      role: "sentinella",
      session: "SENTINELLA",
      instance: null,
      preDelayMs: 3000,
    },
    {
      role: "bridge",
      session: "BRIDGE",
      instance: null,
      preDelayMs: 20000,
      notATmuxSession: true,
      env: { JHT_TARGET_SESSION: "CAPITANO" },
    },
    // Bridge V7 Step 5: daemon che misura il consumo token reale dai log
    // locali e calcola EMA ratio + per-agent rate. Legge lo state file del
    // sentinel bridge (window dinamica), quindi parte dopo di lui.
    {
      role: "token-meter",
      session: "TOKEN-METER",
      instance: null,
      preDelayMs: 5000,
      notATmuxSession: true,
      env: {},
    },
    { role: "mentor", session: "MENTOR", instance: null, preDelayMs: 3000 },
    {
      role: "capitano",
      session: "CAPITANO",
      instance: null,
      preDelayMs: 5000,
      env: { JHT_TICK_INTERVAL: String(tickMin) },
    },
  ];
}

// Quote POSIX-safe per env var passate a bash -c.
const shellQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const repoRoot = path.resolve(process.cwd(), "..");
    // Deleghiamo tutto a .launcher/start-agent.sh: template copy,
    // env var, rilevamento provider (claude/kimi/codex) dal
    // jht.config.json, creazione sessione tmux, lancio CLI, kick-off
    // automatico per capitano e assistente, spawn bridge rate-limit
    // al fianco del Capitano.
    const startAgentScript = toWslPath(
      path.join(repoRoot, ".launcher", "start-agent.sh"),
    );
    const team = await buildTeam();
    const results: {
      session: string;
      role: string;
      status: "started" | "already_active" | "error";
      error?: string;
    }[] = [];

    for (const agent of team) {
      // Pre-delay opzionale: lasciato al singolo agent (es. bridge attende
      // che capitano+sentinella siano stabili prima di partire).
      if (agent.preDelayMs && agent.preDelayMs > 0) {
        await new Promise((r) => setTimeout(r, agent.preDelayMs));
      }

      // I "ruoli" che NON sono sessioni tmux (es. bridge = processo
      // Python background) skippano il check has-session: start-agent.sh
      // gestisce il singleton internamente.
      if (!agent.notATmuxSession) {
        try {
          const { stdout } = await runBash(
            `tmux has-session -t "${agent.session}" 2>&1 && echo "EXISTS" || echo "NEW"`,
          );
          if (stdout.trim() === "EXISTS") {
            results.push({
              session: agent.session,
              role: agent.role,
              status: "already_active",
            });
            continue;
          }
        } catch {
          /* sessione non esiste, procedi */
        }
      }

      try {
        if (agent.env && Object.keys(agent.env).length > 0) {
          // Passiamo env var inline prima di invocare lo script. runScript
          // non supporta env custom, usiamo runBash con prefisso KEY=VAL.
          const envPrefix = Object.entries(agent.env)
            .map(([k, v]) => `${k}=${shellQuote(v)}`)
            .join(" ");
          const args = agent.instance
            ? [agent.role, agent.instance]
            : [agent.role];
          const argsStr = args.map(shellQuote).join(" ");
          await runBash(
            `${envPrefix} bash ${shellQuote(startAgentScript)} ${argsStr}`,
          );
        } else {
          const args = agent.instance
            ? [agent.role, agent.instance]
            : [agent.role];
          await runScript(startAgentScript, ...args);
        }
        results.push({
          session: agent.session,
          role: agent.role,
          status: "started",
        });
      } catch (err: any) {
        results.push({
          session: agent.session,
          role: agent.role,
          status: "error",
          error: err?.message,
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Avvio team fallito" },
      { status: 500 },
    );
  }
}
