import { readFile, access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { JHT_HOME } from '../jht-paths.js';
import { c } from './_colors.js'
import { hint, statusLine, title } from '../lib/ui.js'
import { AGENTS, isAgentSession } from './team/agents.js'
import { LATEST_CONFIG_VERSION } from './migrate.js'

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

function nodeIsTooOld() {
  const [major] = process.version.replace('v', '').split('.').map(Number)
  return major < 18
}

async function checkConfig() {
  if (!(await fileExists(CONFIG_PATH))) return { ok: false, msg: 'No configuration yet', hint: 'jht setup' }
  const cfg = await readConfigAsync()
  if (!cfg) return { ok: false, msg: 'The configuration file cannot be read', hint: 'jht setup --reset' }
  const v = cfg.version ?? 1
  if (v < LATEST_CONFIG_VERSION) return { warn: true, msg: `Config v${v} — update available`, hint: 'jht migrate' }
  return { ok: true, msg: `Config v${v} valid` }
}

async function checkProvider() {
  const cfg = await readConfigAsync()
  if (!cfg) return { skip: true, msg: 'AI provider — not checked, there is no configuration yet' }
  const active = cfg.active_provider
  if (!active) return { warn: true, msg: 'No active providers', hint: 'jht providers use codex   (or claude / kimi)' }
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
  const optional = ['claude', 'pandoc', 'wkhtmltopdf', 'typst', 'python3']
  const results = []
  for (const cmd of required) {
    const v = cmdVersion(cmd)
    if (cmd === 'node' && v && nodeIsTooOld()) { results.push({ ok: false, msg: `node: ${v}`, hint: 'Node 18 or later is required' }); continue }
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
    // tmux may hold the person's own sessions: only the team's count
    if (!sessions.some((s) => AGENTS.some((a) => isAgentSession(s, a)))) return [{ warn: true, msg: 'The team is not running', hint: 'jht team start' }]
    const expected = ['assistente', 'capitano', 'mentor', 'sentinella']
    return expected.map(role => {
      const agent = AGENTS.find(a => a.role === role)
      const active = !!agent && sessions.some(s => isAgentSession(s, agent))
      const name = agent?.prefix ?? role.toUpperCase()
      return active
        ? { ok: true, msg: `${name}: active` }
        : { warn: true, msg: `${name}: not found`, hint: `jht team start ${role}` }
    })
  } catch {
    return [{ skip: true, msg: 'tmux is not available here: the team could not be checked' }]
  }
}

// ── Output ────────────────────────────────────────────────────────────────

const kindOf = (ck) => (ck.ok ? 'ok' : ck.warn ? 'warn' : ck.skip ? 'info' : 'fail')

// ── Main ──────────────────────────────────────────────────────────────────

/**
 * The summary first, then only what needs attention; `--all` lists every check by section and `--json` gives the
 * same data to a script. The exit code is 1 when something is wrong (a problem), 0 for a working system
 * with warnings or nothing.
 */
async function handleDoctor(options) {
  const [configCk, providerCk, apiCk, dbCk, depsCk, workersCk] = await Promise.all([
    checkConfig(), checkProvider(), checkApiKey(),
    checkDatabase(), Promise.resolve(checkDeps()), Promise.resolve(checkWorkers()),
  ])

  const sections = [
    { title: 'Environment', checks: depsCk },
    { title: 'Config',      checks: [configCk] },
    { title: 'AI provider', checks: [providerCk, apiCk] },
    { title: 'Database',    checks: [dbCk] },
    { title: 'Team',        checks: workersCk },
  ]
  const all = sections.flatMap((sec) => sec.checks.map((ck) => ({ section: sec.title, status: kindOf(ck), message: ck.msg, hint: ck.hint ?? null })))
  const count = (status) => all.filter((x) => x.status === status).length
  const problems = count('fail'), warnings = count('warn'), fine = count('ok')
  if (problems > 0) process.exitCode = 1

  if (options.json) {
    console.log(JSON.stringify({ ok: problems === 0, summary: { ok: fine, warnings, problems }, checks: all }, null, 2))
    return
  }

  const parts = [`${fine} ok`]
  if (warnings) parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`)
  if (problems) parts.push(`${problems} ${problems === 1 ? 'problem' : 'problems'}`)
  console.log(title('Check', parts.join(' · ')))

  if (options.all) {
    for (const sec of sections) {
      console.log(`  ${c.bold(sec.title)}`)
      for (const ck of sec.checks) console.log(statusLine(kindOf(ck), ck.msg, { hint: ck.hint, indent: 4 }))
      console.log('')
    }
  } else {
    const needs = all.filter((x) => x.status === 'fail' || x.status === 'warn')
    // the problems first, then the warnings
    for (const x of [...needs.filter((n) => n.status === 'fail'), ...needs.filter((n) => n.status === 'warn')]) {
      console.log(statusLine(x.status, x.message, { hint: x.hint }))
    }
    if (needs.length) console.log('')
    console.log(hint('Every check: jht doctor --all'))
    console.log('')
  }
  if (problems === 0 && warnings === 0) console.log(`  ${c.green('Everything is in order.')}\n`)
}

export function registerDoctorCommand(program) {
  program
    .command('doctor')
    .description('Check the setup: summary first, --all for every check; exits 1 when something is wrong')
    .option('-a, --all', 'list every check, grouped')
    .option('--json', 'machine-readable output')
    .action(handleDoctor)
}
