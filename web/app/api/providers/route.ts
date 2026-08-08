import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { JHT_HOME } from "@/lib/jht-paths";
import { loadJhtConfig, readJsonSafe } from "@/lib/json-files";
import { requireAuth } from "@/lib/auth";
// Le versioni dei CLI provider le dichiara la release, non il registry
// (issue #130). Il JSON viene inlinato a build time — nessun path da
// risolvere a runtime — e la regola di composizione è la stessa di
// shared/runtime/provider-pins.js: `pkg@ver` per npm, `pkg==ver` per uv.
import providerVersions from "../../../../shared/config/provider-versions.json";
import { resolveUpdateTarget } from "@/lib/providers/update-target";

export const dynamic = "force-dynamic";

type AuthMethod = "api_key" | "subscription" | "none";

type ProviderConfig = {
  name: string;
  auth_method?: AuthMethod;
  api_key?: string;
  model?: string;
  subscription?: Record<string, unknown>;
};

type JhtConfig = {
  version?: number;
  active_provider?: string;
  providers?: Record<string, ProviderConfig>;
};

function normalizeProviderId(value: string | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "claude") return "anthropic";
  if (
    normalized === "anthropic" ||
    normalized === "openai" ||
    normalized === "kimi" ||
    normalized === "kimi"
  )
    return normalized;
  return null;
}

const KNOWN_PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-6",
      "claude-haiku-4-5-20251001",
    ],
    envKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-4o-mini", "gpt-4o", "o1", "o1-mini"],
    envKey: "OPENAI_API_KEY",
  },
  {
    id: "kimi",
    label: "Kimi K2",
    models: ["kimi-k2-0711-preview"],
    envKey: "MOONSHOT_API_KEY",
  },
  {
    id: "kimi",
    label: "Kimi",
    models: ["abab6.5s-chat", "abab5.5-chat"],
    envKey: "MOONSHOT_API_KEY",
  },
];

const loadConfig = () => loadJhtConfig<JhtConfig>();

// Tutti gli agenti usano lo stesso pool di sessioni tmux: l'update del
// CLI del provider attivo richiede di stopparle tutte (qualsiasi ruolo).
const ALL_AGENT_SESSION_PREFIXES = [
  "CAPITANO",
  "SCOUT",
  "ANALISTA",
  "SCORER",
  "SCRITTORE",
  "CRITICO",
  "SENTINELLA",
  "ASSISTENTE",
] as const;

// Mapping provider id → come leggere la versione installata/latest e come
// aggiornare. Due kind supportati:
//   - 'npm': installed da package.json del pacchetto global, update via
//     `npm install -g <pkg>@<versione della release>`
//   - 'uv':  installed dal nome della dir dist-info (kimi_cli-X.Y.Z.dist-info),
//     update via `uv tool install --force <pkg>==<versione della release>`
// La versione la decide `shared/config/provider-versions.json` (issue #130),
// non il registry: vedi `installSpecFor`.
// `latestSource` è un path a JSON con `latest_version`. Solo codex lo ha
// (il binario lo scrive per conto suo). Senza latestSource, niente badge —
// il pulsante resta comunque disponibile per re-installare il pin.
type CliSpec =
  | {
      kind: "npm";
      npmPkg: string;
      installedPkgJson: string;
      latestSource?: string;
    }
  | {
      kind: "uv";
      toolName: string; // nome pacchetto PyPI (kimi-cli)
      distInfoGlob: string; // glob del dist-info (kimi_cli-*.dist-info)
      distInfoParent: string; // dir che contiene i dist-info
    };

const NPM_GLOBAL = path.join(JHT_HOME, ".npm-global", "lib", "node_modules");
const CODEX_HOME = path.join(JHT_HOME, ".codex");
const KIMI_SITE_PACKAGES = path.join(
  JHT_HOME,
  ".local",
  "share",
  "uv",
  "tools",
  "kimi-cli",
  "lib",
  "python3.13",
  "site-packages",
);

type Pin = { kind: string; package: string; version: string };
const PINS = providerVersions.pins as Record<string, Pin>;

// Gli id del web (anthropic/openai/kimi) non sono le chiavi del manifest
// (claude/codex/kimi): la mappa è qui, esplicita, come `resolveUpdateTarget`
// nella CLI.
const PIN_KEY: Record<string, string> = {
  anthropic: "claude",
  openai: "codex",
  kimi: "kimi",
};

/**
 * Lo specificatore da installare per `providerId`. Il bottone della dashboard
 * è un aggiornamento ESPLICITO dell'utente, ma esplicito non vuol dire
 * "prendi quello che c'è adesso sul registry": la macchina deve restare sulla
 * versione che questa release dichiara, altrimenti un click riporterebbe il
 * drift che il pin serve a evitare (e il boot successivo lo annullerebbe
 * comunque, reinstallando il pin).
 *
 * Pin assente o malformato → `@latest`, come prima: meglio un'installazione
 * non riproducibile che un provider che non si installa.
 */
function installSpecFor(providerId: string): string | null {
  const pin = PINS[PIN_KEY[providerId] ?? ""];
  if (!pin?.package) return null;
  const version = /^\d+\.\d+\.\d+/.test(pin.version || "") ? pin.version : null;
  if (!version)
    return pin.kind === "uv" ? pin.package : `${pin.package}@latest`;
  return pin.kind === "uv"
    ? `${pin.package}==${version}`
    : `${pin.package}@${version}`;
}

const CLI_SPECS: Record<string, CliSpec> = {
  anthropic: {
    kind: "npm",
    npmPkg: "@anthropic-ai/claude-code",
    installedPkgJson: path.join(
      NPM_GLOBAL,
      "@anthropic-ai",
      "claude-code",
      "package.json",
    ),
  },
  openai: {
    kind: "npm",
    npmPkg: "@openai/codex",
    installedPkgJson: path.join(NPM_GLOBAL, "@openai", "codex", "package.json"),
    latestSource: path.join(CODEX_HOME, "version.json"),
  },
  kimi: {
    kind: "uv",
    toolName: "kimi-cli",
    distInfoGlob: "kimi_cli-", // prefisso, matchiamo nel readdir
    distInfoParent: KIMI_SITE_PACKAGES,
  },
};

function readUvToolVersion(
  distInfoParent: string,
  prefix: string,
): string | null {
  // Cerca una dir tipo `kimi_cli-1.38.0.dist-info` e ne estrae la versione
  // dal nome. uv tool tiene un solo dist-info per pacchetto, quindi basta
  // il primo match.
  try {
    const entries = fs.readdirSync(distInfoParent);
    for (const name of entries) {
      if (!name.startsWith(prefix) || !name.endsWith(".dist-info")) continue;
      const m = name.match(new RegExp(`^${prefix}(.+)\\.dist-info$`));
      if (m) return m[1];
    }
  } catch {
    /* dir assente */
  }
  return null;
}

/** La versione del pin per questo provider, se dichiarata e ben formata. */
function pinnedVersionFor(providerId: string): string | null {
  const pin = PINS[PIN_KEY[providerId] ?? ""];
  const version = pin?.version ?? "";
  return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

/**
 * Versione installata e versione che il bottone porterebbe.
 *
 * Il bersaglio NON è più l'ultima del registry: è quella che
 * `installSpecFor` installa davvero, cioè il pin della release. Prima il
 * badge leggeva `~/.codex/version.json` e poteva quindi indicare un numero
 * diverso da quello che il click avrebbe messo sulla macchina.
 */
function readVersionInfo(providerId: string): {
  installedVersion: string | null;
  targetVersion: string | null;
} {
  const spec = CLI_SPECS[providerId];
  if (!spec) return { installedVersion: null, targetVersion: null };
  const installedVersion =
    spec.kind === "npm"
      ? (readJsonSafe<{ version?: string }>(spec.installedPkgJson)?.version ??
        null)
      : readUvToolVersion(spec.distInfoParent, spec.distInfoGlob);
  // Il registry serve solo come ripiego, e solo dove il pin manca: è
  // esattamente il caso in cui `installSpecFor` cade su `@latest`, quindi
  // l'etichetta continua a descrivere ciò che il bottone farebbe.
  const registryLatest =
    spec.kind === "npm" && spec.latestSource
      ? (readJsonSafe<{ latest_version?: string }>(spec.latestSource)
          ?.latest_version ?? null)
      : null;
  const { targetVersion } = resolveUpdateTarget({
    pinnedVersion: pinnedVersionFor(providerId),
    registryLatest,
    installedVersion,
  });
  return { installedVersion, targetVersion };
}

function listActiveSessions(): string[] {
  try {
    const out = execSync(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null || true',
      { encoding: "utf-8" },
    );
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function activeSessionsForProvider(providerId: string): string[] {
  if (!CLI_SPECS[providerId]) return [];
  const all = listActiveSessions();
  return all.filter((s) =>
    ALL_AGENT_SESSION_PREFIXES.some(
      (prefix) => s === prefix || s.startsWith(prefix + "-"),
    ),
  );
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const config = loadConfig();
  const activeProvider =
    normalizeProviderId(config.active_provider) ??
    normalizeProviderId(process.env.JHT_LLM_PROVIDER) ??
    "anthropic";

  const providers = KNOWN_PROVIDERS.map((p) => {
    const providerCfg =
      config.providers?.[p.id] ??
      (p.id === "anthropic" ? config.providers?.claude : undefined);
    const hasEnvKey = !!process.env[p.envKey];
    const hasConfigKey = !!(providerCfg?.api_key || providerCfg?.subscription);
    const available = hasEnvKey || hasConfigKey;
    const activeModel = providerCfg?.model ?? p.models[0];

    const { installedVersion, targetVersion } = readVersionInfo(p.id);
    // Si propone l'aggiornamento solo se il bersaglio è più NUOVO
    // dell'installata: una macchina può stare più avanti del pin (oggi kimi
    // è pinnata alla 1.36.0 mentre PyPI pubblica la 1.49.0), e lì il
    // bottone resta utile per riallineare ma chiamarlo «aggiornamento»
    // sarebbe falso. Versioni non confrontabili → nessun invito.
    const { updateAvailable } = resolveUpdateTarget({
      pinnedVersion: pinnedVersionFor(p.id),
      registryLatest: targetVersion,
      installedVersion,
    });
    const updatable = !!CLI_SPECS[p.id];

    return {
      id: p.id,
      label: p.label,
      available,
      active: p.id === activeProvider,
      authMethod: providerCfg?.auth_method ?? (hasEnvKey ? "api_key" : "none"),
      models: p.models,
      activeModel,
      keySource: hasConfigKey ? "config" : hasEnvKey ? "env" : null,
      installedVersion,
      targetVersion,
      updateAvailable,
      updatable,
    };
  });

  return NextResponse.json({
    providers,
    activeProvider,
    configLoaded: Object.keys(config).length > 0,
  });
}

// POST /api/providers — body { providerId, force? }
// Aggiorna il CLI del provider scelto a @latest. Preflight: se ci sono
// sessioni tmux del team attive (il CLI del provider attivo gira in quei
// pannelli), l'update fallirebbe con EACCES su NTFS durante rename(), quindi
// rifiutiamo con 409 e la lista sessioni da stoppare. Con `force=true` le
// stoppiamo noi. Il comando gira dentro questo container stesso: siamo già
// user jht, /jht_home/.npm-global è scrivibile, e `npm install -g` è il
// flusso standard del wizard di install (vedi desktop/provider-install.js).
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  let body: { providerId?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* body vuoto / invalido */
  }

  const providerId = normalizeProviderId(body.providerId);
  if (!providerId || !CLI_SPECS[providerId]) {
    return NextResponse.json(
      { ok: false, error: `provider non supportato: ${body.providerId}` },
      { status: 400 },
    );
  }

  const spec = CLI_SPECS[providerId];
  const running = activeSessionsForProvider(providerId);

  // Solo le sessioni del provider ATTIVO usano davvero il suo CLI; se sto
  // aggiornando un provider non attivo, nessuna sessione lo tiene aperto →
  // skip del preflight anche se ci sono agenti up.
  const config = loadConfig();
  const active = normalizeProviderId(config.active_provider) ?? "anthropic";
  const shouldCheck = providerId === active;
  const stopped: string[] = [];

  if (shouldCheck && running.length > 0 && !body.force) {
    return NextResponse.json(
      {
        ok: false,
        error: "agenti attivi: stoppa il team prima o invia force=true",
        runningSessions: running,
      },
      { status: 409 },
    );
  }

  if (shouldCheck && running.length > 0 && body.force) {
    for (const sess of running) {
      try {
        execSync(`tmux kill-session -t "${sess}" 2>/dev/null || true`, {
          encoding: "utf-8",
        });
        stopped.push(sess);
      } catch {
        /* best effort */
      }
    }
  }

  let r: ReturnType<typeof spawnSync>;
  if (spec.kind === "npm") {
    r = spawnSync(
      "npm",
      ["install", "-g", installSpecFor(providerId) ?? spec.npmPkg],
      {
        encoding: "utf-8",
        env: {
          ...process.env,
          NPM_CONFIG_PREFIX: path.join(JHT_HOME, ".npm-global"),
        },
        timeout: 180_000,
      },
    );
  } else {
    // uv tool install --force: ricrea il venv e pinna l'ultima versione
    // dal PyPI. `--python 3.13` per coerenza con provider-install.js
    // (kimi-cli richiede 3.13). Bin dir deve puntare a /jht_home/.npm-global/bin
    // perché è già su PATH come bind-mount persistente.
    const localBin = path.join(JHT_HOME, ".local", "bin");
    r = spawnSync(
      "sh",
      [
        "-c",
        [
          "set -e",
          `export PATH="${localBin}:$PATH"`,
          "pip3 install --user --break-system-packages --upgrade uv >/dev/null 2>&1 || true",
          `UV_TOOL_BIN_DIR=${path.join(JHT_HOME, ".npm-global", "bin")} uv tool install --force --python 3.13 ${installSpecFor(providerId) ?? spec.toolName}`,
        ].join(" && "),
      ],
      {
        encoding: "utf-8",
        env: { ...process.env, HOME: JHT_HOME },
        timeout: 300_000, // uv + pip first-time può essere lento (download Python 3.13)
      },
    );
  }

  const ok = r.status === 0;
  const { installedVersion } = readVersionInfo(providerId);

  return NextResponse.json(
    {
      ok,
      providerId,
      stoppedSessions: stopped,
      installedVersion,
      stdout: String(r.stdout || "").trim(),
      stderr: String(r.stderr || "").trim(),
      code: r.status,
    },
    { status: ok ? 200 : 500 },
  );
}
