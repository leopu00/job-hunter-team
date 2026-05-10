import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type AuthMethod = 'api_key' | 'subscription' | 'none'

type ProviderConfig = {
  name: string
  auth_method?: AuthMethod
  api_key?: string
  model?: string
  subscription?: Record<string, unknown>
}

type JhtConfig = {
  version?: number
  active_provider?: string
  providers?: Record<string, ProviderConfig>
}

function normalizeProviderId(value: string | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'claude') return 'anthropic'
  if (normalized === 'anthropic' || normalized === 'openai' || normalized === 'kimi' || normalized === 'minimax') return normalized
  return null
}

const KNOWN_PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'o1', 'o1-mini'],
    envKey: 'OPENAI_API_KEY',
  },
  {
    id: 'kimi',
    label: 'Kimi K2',
    models: ['kimi-k2-0711-preview'],
    envKey: 'MOONSHOT_API_KEY',
  },
  {
    id: 'minimax',
    label: 'Minimax',
    models: ['abab6.5s-chat', 'abab5.5-chat'],
    envKey: 'MINIMAX_API_KEY',
  },
]

function loadConfig(): JhtConfig {
  const candidates = [
    path.join(JHT_HOME, 'jht.config.json'),
    path.join(process.cwd(), 'jht.config.json'),
    path.join(process.cwd(), '..', 'jht.config.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as JhtConfig
    } catch { /* continua */ }
  }
  return {}
}

// Tutti gli agenti usano lo stesso pool di sessioni tmux: l'update del
// CLI del provider attivo richiede di stopparle tutte (qualsiasi ruolo).
const ALL_AGENT_SESSION_PREFIXES = ['CAPITANO', 'SCOUT', 'ANALISTA', 'SCORER', 'SCRITTORE', 'CRITICO', 'SENTINELLA', 'ASSISTENTE'] as const

// Mapping provider id → come leggere la versione installata/latest e come
// aggiornare. Due kind supportati:
//   - 'npm': installed da package.json del pacchetto global, update via
//     `npm install -g <pkg>@latest`
//   - 'uv':  installed dal nome della dir dist-info (kimi_cli-X.Y.Z.dist-info),
//     update via `uv tool install --force <pkg>`
// `latestSource` è un path a JSON con `latest_version`. Solo codex lo ha
// (il binario lo scrive per conto suo). Senza latestSource, niente badge —
// il pulsante resta comunque disponibile per fare re-install "@latest".
type CliSpec =
  | {
      kind: 'npm'
      npmPkg: string
      installedPkgJson: string
      latestSource?: string
    }
  | {
      kind: 'uv'
      toolName: string           // nome pacchetto PyPI (kimi-cli)
      distInfoGlob: string       // glob del dist-info (kimi_cli-*.dist-info)
      distInfoParent: string     // dir che contiene i dist-info
    }

const NPM_GLOBAL = path.join(JHT_HOME, '.npm-global', 'lib', 'node_modules')
const CODEX_HOME = path.join(JHT_HOME, '.codex')
const KIMI_SITE_PACKAGES = path.join(JHT_HOME, '.local', 'share', 'uv', 'tools', 'kimi-cli', 'lib', 'python3.13', 'site-packages')

const CLI_SPECS: Record<string, CliSpec> = {
  anthropic: {
    kind: 'npm',
    npmPkg: '@anthropic-ai/claude-code@latest',
    installedPkgJson: path.join(NPM_GLOBAL, '@anthropic-ai', 'claude-code', 'package.json'),
  },
  openai: {
    kind: 'npm',
    npmPkg: '@openai/codex@latest',
    installedPkgJson: path.join(NPM_GLOBAL, '@openai', 'codex', 'package.json'),
    latestSource: path.join(CODEX_HOME, 'version.json'),
  },
  kimi: {
    kind: 'uv',
    toolName: 'kimi-cli',
    distInfoGlob: 'kimi_cli-',        // prefisso, matchiamo nel readdir
    distInfoParent: KIMI_SITE_PACKAGES,
  },
}

function readJson(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

function readUvToolVersion(distInfoParent: string, prefix: string): string | null {
  // Cerca una dir tipo `kimi_cli-1.38.0.dist-info` e ne estrae la versione
  // dal nome. uv tool tiene un solo dist-info per pacchetto, quindi basta
  // il primo match.
  try {
    const entries = fs.readdirSync(distInfoParent)
    for (const name of entries) {
      if (!name.startsWith(prefix) || !name.endsWith('.dist-info')) continue
      const m = name.match(new RegExp(`^${prefix}(.+)\\.dist-info$`))
      if (m) return m[1]
    }
  } catch { /* dir assente */ }
  return null
}

function readVersionInfo(providerId: string): { installedVersion: string | null; latestVersion: string | null } {
  const spec = CLI_SPECS[providerId]
  if (!spec) return { installedVersion: null, latestVersion: null }
  if (spec.kind === 'npm') {
    const pkg = readJson(spec.installedPkgJson)
    const installedVersion = pkg?.version ?? null
    const latestJson = spec.latestSource ? readJson(spec.latestSource) : null
    const latestVersion = latestJson?.latest_version ?? null
    return { installedVersion, latestVersion }
  }
  // uv tool: latest version non disponibile offline — lasciamo null
  return {
    installedVersion: readUvToolVersion(spec.distInfoParent, spec.distInfoGlob),
    latestVersion: null,
  }
}

function listActiveSessions(): string[] {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true', { encoding: 'utf-8' })
    return out.split('\n').map(s => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function activeSessionsForProvider(providerId: string): string[] {
  if (!CLI_SPECS[providerId]) return []
  const all = listActiveSessions()
  return all.filter(s => ALL_AGENT_SESSION_PREFIXES.some(prefix => s === prefix || s.startsWith(prefix + '-')))
}

export async function GET() {
  const denied = await requireAuth()
  if (denied) return denied
  const config = loadConfig()
  const activeProvider =
    normalizeProviderId(config.active_provider) ??
    normalizeProviderId(process.env.JHT_LLM_PROVIDER) ??
    'anthropic'

  const providers = KNOWN_PROVIDERS.map(p => {
    const providerCfg = config.providers?.[p.id] ?? (p.id === 'anthropic' ? config.providers?.claude : undefined)
    const hasEnvKey = !!process.env[p.envKey]
    const hasConfigKey = !!(providerCfg?.api_key || providerCfg?.subscription)
    const available = hasEnvKey || hasConfigKey
    const activeModel = providerCfg?.model ?? p.models[0]

    const { installedVersion, latestVersion } = readVersionInfo(p.id)
    // updateAvailable richiede entrambi i valori + disuguaglianza. Per
    // provider senza `latestSource` (es. anthropic) `latestVersion` è
    // sempre null → mai "available", quindi niente falsi positivi.
    const updateAvailable = !!(installedVersion && latestVersion && installedVersion !== latestVersion)
    const updatable = !!CLI_SPECS[p.id]

    return {
      id: p.id,
      label: p.label,
      available,
      active: p.id === activeProvider,
      authMethod: providerCfg?.auth_method ?? (hasEnvKey ? 'api_key' : 'none'),
      models: p.models,
      activeModel,
      keySource: hasConfigKey ? 'config' : hasEnvKey ? 'env' : null,
      installedVersion,
      latestVersion,
      updateAvailable,
      updatable,
    }
  })

  return NextResponse.json({
    providers,
    activeProvider,
    configLoaded: Object.keys(config).length > 0,
  })
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
  const denied = await requireAuth()
  if (denied) return denied
  let body: { providerId?: string; force?: boolean } = {}
  try { body = await req.json() } catch { /* body vuoto / invalido */ }

  const providerId = normalizeProviderId(body.providerId)
  if (!providerId || !CLI_SPECS[providerId]) {
    return NextResponse.json({ ok: false, error: `provider non supportato: ${body.providerId}` }, { status: 400 })
  }

  const spec = CLI_SPECS[providerId]
  const running = activeSessionsForProvider(providerId)

  // Solo le sessioni del provider ATTIVO usano davvero il suo CLI; se sto
  // aggiornando un provider non attivo, nessuna sessione lo tiene aperto →
  // skip del preflight anche se ci sono agenti up.
  const config = loadConfig()
  const active = normalizeProviderId(config.active_provider) ?? 'anthropic'
  const shouldCheck = providerId === active
  const stopped: string[] = []

  if (shouldCheck && running.length > 0 && !body.force) {
    return NextResponse.json({
      ok: false,
      error: 'agenti attivi: stoppa il team prima o invia force=true',
      runningSessions: running,
    }, { status: 409 })
  }

  if (shouldCheck && running.length > 0 && body.force) {
    for (const sess of running) {
      try {
        execSync(`tmux kill-session -t "${sess}" 2>/dev/null || true`, { encoding: 'utf-8' })
        stopped.push(sess)
      } catch { /* best effort */ }
    }
  }

  let r: ReturnType<typeof spawnSync>
  if (spec.kind === 'npm') {
    r = spawnSync('npm', ['install', '-g', spec.npmPkg], {
      encoding: 'utf-8',
      env: { ...process.env, NPM_CONFIG_PREFIX: path.join(JHT_HOME, '.npm-global') },
      timeout: 180_000,
    })
  } else {
    // uv tool install --force: ricrea il venv e pinna l'ultima versione
    // dal PyPI. `--python 3.13` per coerenza con provider-install.js
    // (kimi-cli richiede 3.13). Bin dir deve puntare a /jht_home/.npm-global/bin
    // perché è già su PATH come bind-mount persistente.
    const localBin = path.join(JHT_HOME, '.local', 'bin')
    r = spawnSync('sh', ['-c', [
      'set -e',
      `export PATH="${localBin}:$PATH"`,
      'pip3 install --user --break-system-packages --upgrade uv >/dev/null 2>&1 || true',
      `UV_TOOL_BIN_DIR=${path.join(JHT_HOME, '.npm-global', 'bin')} uv tool install --force --python 3.13 ${spec.toolName}`,
    ].join(' && ')], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: JHT_HOME },
      timeout: 300_000,  // uv + pip first-time può essere lento (download Python 3.13)
    })
  }

  const ok = r.status === 0
  const { installedVersion } = readVersionInfo(providerId)

  return NextResponse.json({
    ok,
    providerId,
    stoppedSessions: stopped,
    installedVersion,
    stdout: String(r.stdout || '').trim(),
    stderr: String(r.stderr || '').trim(),
    code: r.status,
  }, { status: ok ? 200 : 500 })
}
