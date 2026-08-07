import { readFile, access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import * as clack from '@clack/prompts'
import pc from 'picocolors'
import { JHT_HOME } from '../jht-paths.js';
import { isInteractive } from './_colors.js'
import { AGENTS, isAgentSession } from './team/agents.js'

/**
 * Spinner solo su TTY. [CLI-OUTPUT-NOT-MACHINE-SAFE]
 * Lo spinner di clack anima nascondendo il cursore (`\x1b[?25l`) e riscrivendo
 * la riga: sequenze che picocolors non disattiva perche' non sono colore.
 * `jht doctor > diagnosi.txt` e' un gesto normale — non deve raccoglierle.
 */
function spinner() {
  if (isInteractive()) return clack.spinner()
  return {
    start: (msg) => { if (msg) clack.log.info(msg) },
    stop:  (msg) => { if (msg) clack.log.info(msg) },
    message: (msg) => { if (msg) clack.log.info(msg) },
  }
}

const JHT_DIR     = JHT_HOME
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json')

// ── Helpers ──────────────────────────────────────────────────────────────

async function fileExists(p) {
  try { await access(p); return true } catch { return false }
}

const VERSION_FLAGS = { tmux: '-V' }

function cmdVersion(cmd) {
  const flag = VERSION_FLAGS[cmd] ?? '--version'
  try { return execSync(`${cmd} ${flag} 2>/dev/null`, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0] }
  catch { return null }
}

function cmdExists(cmd) { return cmdVersion(cmd) !== null }

function readConfig() {
  try { return JSON.parse(require('node:fs').readFileSync(CONFIG_PATH, 'utf-8')) }
  catch { return null }
}

async function readConfigAsync() {
  if (!(await fileExists(CONFIG_PATH))) return null
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf-8')) } catch { return null }
}

// ── Check functions ───────────────────────────────────────────────────────

async function checkNode() {
  const v = process.version
  const [major] = v.replace('v','').split('.').map(Number)
  if (major < 18) return { ok: false, msg: `Node ${v}`, hint: 'Required Node ≥18' }
  return { ok: true, msg: `Node ${v}` }
}

async function checkConfig() {
  if (!(await fileExists(CONFIG_PATH))) return { ok: false, msg: 'jht.config.json not found', hint: 'Run: jht setup' }
  const cfg = await readConfigAsync()
  if (!cfg) return { ok: false, msg: 'Invalid config JSON', hint: 'Run: jht setup --reset' }
  const v = cfg.version ?? 1
  if (v < 4) return { warn: true, msg: `Config v${v} — update available`, hint: 'Run: jht migrate' }
  return { ok: true, msg: `Config v${v} valid` }
}

async function checkProvider() {
  const cfg = await readConfigAsync()
  if (!cfg) return { ok: false, msg: 'Providers — missing config' }
  const active = cfg.active_provider
  if (!active) return { warn: true, msg: 'No active providers', hint: 'Run: jht config set active_provider anthropic' }
  const prov = cfg.providers?.[active]
  // Le subscription usano la sessione OAuth della CLI e non hanno, per
  // definizione, una API key nel config. Segnalarle come incomplete rende il
  // doctor fuorviante proprio dopo un login riuscito dal wizard desktop.
  if (prov?.auth_method === 'subscription' || prov?.auth_method === 'cli') {
    return { ok: true, msg: `Provider: ${active}${prov?.model ? ` (${prov.model})` : ''} — subscription` }
  }

  // Non lasciare che la key di un provider mascheri la configurazione
  // incompleta di un altro provider attivo.
  const envName = active === 'anthropic'
    ? 'ANTHROPIC_API_KEY'
    : active === 'openai'
      ? 'OPENAI_API_KEY'
      : `${active.toUpperCase()}_API_KEY`
  const key = prov?.api_key || process.env[envName]
  if (!key) return { warn: true, msg: `Provider ${active} has no API key`, hint: `Set ${envName}` }
  return { ok: true, msg: `Provider: ${active}${prov?.model ? ` (${prov.model})` : ''}` }
}

async function checkApiKey() {
  const cfg = await readConfigAsync()
  const key = cfg?.providers?.anthropic?.api_key || process.env.ANTHROPIC_API_KEY
  if (!key) return { skip: true, msg: 'API test — no Anthropic key found' }
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return { ok: true, msg: 'Anthropic API key valid' }
    if (res.status === 401) return { ok: false, msg: 'Invalid Anthropic API key (401)', hint: 'Update ANTHROPIC_API_KEY' }
    return { warn: true, msg: `Anthropic API response ${res.status}` }
  } catch (e) {
    if (e.name === 'TimeoutError') return { warn: true, msg: 'Anthropic API timeout (>5s)' }
    return { warn: true, msg: 'Anthropic API unreachable' }
  }
}

async function checkDatabase() {
  const cfg = await readConfigAsync()
  const url = cfg?.supabase?.url || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return { skip: true, msg: 'Database — SUPABASE_URL not configured' }
  try {
    const res = await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) })
    if (res.status < 500) return { ok: true, msg: `Database Supabase accessible` }
    return { ok: false, msg: `Supabase database error ${res.status}` }
  } catch {
    return { ok: false, msg: 'Supabase database is not reachable', hint: 'Check SUPABASE_URL and network access' }
  }
}

function checkDeps() {
  const required = ['node', 'npm', 'tmux', 'git']
  const optional = ['claude', 'pandoc', 'typst', 'python3']
  const results = []
  for (const cmd of required) {
    const v = cmdVersion(cmd)
    results.push(v ? { ok: true, msg: `${cmd}: ${v}` } : { ok: false, msg: `${cmd}: not found`, hint: `Install ${cmd}` })
  }
  for (const cmd of optional) {
    const v = cmdVersion(cmd)
    results.push(v ? { ok: true, msg: `${cmd}: ${v}` } : { skip: true, msg: `${cmd}: not found (optional)` })
  }
  return results
}

function checkWorkers() {
  try {
    const sessions = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' })
      .trim().split('\n').filter(Boolean)
    if (!sessions.length) return [{ warn: true, msg: 'No active tmux session', hint: 'Start workers with the Coordinator' }]
    const expected = ['assistente', 'capitano', 'mentor', 'sentinella']
    return expected.map(role => {
      const agent = AGENTS.find(a => a.role === role)
      const active = !!agent && sessions.some(s => isAgentSession(s, agent))
      const name = agent?.prefix ?? role.toUpperCase()
      return active
        ? { ok: true, msg: `${name}: active` }
        : { warn: true, msg: `${name}: not found`, hint: `Run: jht team start ${role}` }
    })
  } catch {
    return [{ skip: true, msg: 'tmux not available — verify workers manually' }]
  }
}

// ── Output helpers ────────────────────────────────────────────────────────

function printCheck({ ok, warn, skip, msg, hint }) {
  if (ok)   clack.log.success(msg)
  else if (warn) clack.log.warn(msg)
  else if (skip) clack.log.info(pc.dim(msg))
  else      clack.log.error(msg)
  if (hint) clack.log.message(pc.dim(`  ↳ ${hint}`))
}

// ── Main ──────────────────────────────────────────────────────────────────

async function handleDoctor() {
  clack.intro(pc.bold('JHT — Doctor'))

  const s = spinner()

  s.start('Check in progress...')

  const [nodeCk, configCk, providerCk, apiCk, dbCk, depsCk, workersCk] = await Promise.all([
    checkNode(), checkConfig(), checkProvider(), checkApiKey(),
    checkDatabase(), Promise.resolve(checkDeps()), Promise.resolve(checkWorkers()),
  ])

  s.stop('Diagnosis completed')

  const sections = [
    { title: 'Environment', checks: [nodeCk, ...depsCk] },
    { title: 'Config',      checks: [configCk] },
    { title: 'Provider LLM', checks: [providerCk, apiCk] },
    { title: 'Database',    checks: [dbCk] },
    { title: 'Workers',     checks: workersCk },
  ]

  let errors = 0, warnings = 0
  for (const sec of sections) {
    clack.log.message(pc.bold(sec.title))
    for (const c of sec.checks) {
      printCheck(c)
      if (!c.ok && !c.warn && !c.skip) errors++
      if (c.warn) warnings++
    }
  }

  if (errors > 0)
    clack.outro(pc.red(`${errors} errors to be resolved — run the suggested fixes`))
  else if (warnings > 0)
    clack.outro(pc.yellow(`${warnings} alerts — working system with limitations`))
  else
    clack.outro(pc.green('All OK — ready system'))
}

export function registerDoctorCommand(program) {
  program
    .command('doctor')
    .description('Check setup — config, provider, API key, database, and workers')
    .action(handleDoctor)
}
