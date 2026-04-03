import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const PLUGINS_DIR = path.join(os.homedir(), '.jht', 'plugins')
const CONFIG_PATH = path.join(os.homedir(), '.jht', 'plugins-config.json')
const MANIFEST_FILE = 'jht.plugin.json'

type PluginKind = 'skill' | 'channel' | 'storage' | 'provider' | 'tool' | 'integration'

type PluginManifest = {
  id: string; name: string; version: string; description?: string
  kind?: PluginKind | PluginKind[]; enabledByDefault?: boolean
  envVars?: string[]; dependencies?: string[]
}

type PluginsConfig = { deny: string[]; pluginConfig: Record<string, Record<string, unknown>> }

function loadConfig(): PluginsConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return { deny: Array.isArray(raw.deny) ? raw.deny : [], pluginConfig: raw.pluginConfig ?? {} }
  } catch { return { deny: [], pluginConfig: {} } }
}

function saveConfig(config: PluginsConfig) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

function discoverPlugins(): { manifest: PluginManifest; rootDir: string }[] {
  if (!fs.existsSync(PLUGINS_DIR)) return []
  const results: { manifest: PluginManifest; rootDir: string }[] = []
  for (const entry of fs.readdirSync(PLUGINS_DIR)) {
    const dir = path.join(PLUGINS_DIR, entry)
    const manifestPath = path.join(dir, MANIFEST_FILE)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      if (!fs.existsSync(manifestPath)) continue
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest
      if (manifest.id && manifest.name) results.push({ manifest, rootDir: dir })
    } catch { /* skip invalid */ }
  }
  return results
}

/** GET — lista plugin scoperti con stato abilitato/disabilitato */
export async function GET() {
  const discovered = discoverPlugins()
  const config = loadConfig()
  const plugins = discovered.map(({ manifest }) => {
    const denied = config.deny.includes(manifest.id)
    const enabled = !denied && (manifest.enabledByDefault !== false)
    return {
      id: manifest.id, name: manifest.name, version: manifest.version,
      description: manifest.description ?? '', kind: manifest.kind ?? 'tool',
      enabled, enabledByDefault: manifest.enabledByDefault !== false,
      envVars: manifest.envVars ?? [], dependencies: manifest.dependencies ?? [],
    }
  })
  return NextResponse.json({
    plugins, total: plugins.length,
    enabled: plugins.filter(p => p.enabled).length,
  })
}

/** POST — attiva/disattiva plugin: { id: string, enabled: boolean } */
export async function POST(req: NextRequest) {
  let body: { id?: string; enabled?: boolean } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.id || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'id e enabled obbligatori' }, { status: 400 })
  }
  const discovered = discoverPlugins()
  if (!discovered.find(p => p.manifest.id === body.id)) {
    return NextResponse.json({ ok: false, error: 'Plugin non trovato' }, { status: 404 })
  }
  const config = loadConfig()
  if (body.enabled) {
    config.deny = config.deny.filter(id => id !== body.id)
  } else {
    if (!config.deny.includes(body.id!)) config.deny.push(body.id!)
  }
  saveConfig(config)
  return NextResponse.json({ ok: true, id: body.id, enabled: body.enabled })
}
