import { readFile, access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { JHT_HOME } from '../jht-paths.js';
import { c } from './_colors.js'
import { hint, statusLine, title } from '../lib/ui.js'
import { later, say, show } from '../lib/texts.js'
import { AGENTS, isAgentSession } from './team/agents.js'
import { LATEST_CONFIG_VERSION } from './migrate.js'
import { PI_API_PROVIDERS, piApiProvider } from '../../../shared/runtime/provider-models.js'
import { providerSignedIn } from '../lib/provider-signin.js'
import { creditGone } from '../lib/provider-credit.js'

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
  if (!(await fileExists(CONFIG_PATH))) return { ok: false, msg: later('doctor.config_none'), hint: 'jht setup' }
  const cfg = await readConfigAsync()
  if (!cfg) return { ok: false, msg: later('doctor.config_unreadable'), hint: 'jht setup --reset' }
  const v = cfg.version ?? 1
  if (v < LATEST_CONFIG_VERSION) return { warn: true, msg: later('doctor.config_old', { v }), hint: 'jht migrate' }
  return { ok: true, msg: later('doctor.config_ok', { v }) }
}

/**
 * Whether a key reference of the config (what `jht setup` writes for glm and kimi: a file of the key store, or a variable) leads to a
 * key: true or false, never the key. A reference that runs a command is not run here.
 */
function keyOfRef(ref) {
  if (!ref || typeof ref !== 'object') return false
  if (ref.source === 'env') return typeof ref.id === 'string' && Boolean(process.env[ref.id])
  if (ref.source === 'file') {
    try { return Boolean(typeof ref.path === 'string' && statSync(ref.path).isFile() && statSync(ref.path).size > 0) } catch { return false }
  }
  return false
}

async function checkProvider() {
  const cfg = await readConfigAsync()
  if (!cfg) return { skip: true, msg: later('doctor.provider_skip') }
  const active = cfg.active_provider
  if (!active) return { warn: true, msg: later('doctor.provider_none'), hint: later('doctor.provider_use') }
  const prov = cfg.providers?.[active]
  // Le subscription usano la sessione OAuth della CLI e non hanno, per
  // definizione, una API key nel config. Segnalarle come incomplete rende il
  // doctor fuorviante proprio dopo un login riuscito dal wizard desktop.
  // Ma il login deve esserci davvero: un setup interrotto alla schermata di login lascia una config
  // completa e nessun accesso, e il doctor diceva «Tutto a posto» (collaudo Mac del 12/11).
  if (prov?.auth_method === 'subscription' || prov?.auth_method === 'cli') {
    const name = `${active}${prov?.model ? ` (${prov.model})` : ''}`
    if (!(await providerSignedIn(cfg, JHT_HOME))) {
      return { warn: true, msg: later('doctor.provider_signin_missing', { name }), hint: later('doctor.provider_signin_hint') }
    }
    return { ok: true, msg: later('doctor.provider_subscription', { name }) }
  }

  // Non lasciare che la key di un provider mascheri la configurazione
  // incompleta di un altro provider attivo.
  const piApi = piApiProvider(active)
  const envName = active === 'anthropic'
    ? 'ANTHROPIC_API_KEY'
    : active === 'openai'
      ? 'OPENAI_API_KEY'
      : piApi
        ? PI_API_PROVIDERS[piApi].keyVariable
        : `${active.toUpperCase()}_API_KEY`
  const key = prov?.api_key || keyOfRef(prov?.api_key_ref) || process.env[envName]
  if (!key) return { warn: true, msg: later('doctor.provider_nokey', { active }), hint: later('doctor.provider_setenv', { env: envName }) }
  const name = `${active}${prov?.model ? ` (${prov.model})` : ''}`
  // A key the provider accepts on an empty balance: every call comes back 429 and the doctor used to say nothing.
  const credit = creditGone()
  if (credit) return { warn: true, msg: later('doctor.provider_credit_gone', { name, provider: credit.label }), hint: later('doctor.provider_credit_hint') }
  return { ok: true, msg: later('doctor.provider_line', { name }) }
}

// Only for a team on Anthropic: with Codex, GLM or Kimi a missing Anthropic key is not a fact about this team, and
// telling it to the person only reads as something wrong (null: the check is not shown).
async function checkApiKey() {
  const cfg = await readConfigAsync()
  const key = cfg?.providers?.anthropic?.api_key || process.env.ANTHROPIC_API_KEY
  if (!key && cfg?.active_provider !== 'anthropic') return null
  if (!key) return { skip: true, msg: later('doctor.api_skip') }
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return { ok: true, msg: later('doctor.api_ok') }
    if (res.status === 401) return { ok: false, msg: later('doctor.api_invalid'), hint: later('doctor.api_update') }
    return { warn: true, msg: later('doctor.api_response', { status: res.status }) }
  } catch (e) {
    if (e.name === 'TimeoutError') return { warn: true, msg: later('doctor.api_timeout') }
    return { warn: true, msg: later('doctor.api_unreachable') }
  }
}

async function checkDatabase() {
  const cfg = await readConfigAsync()
  const url = cfg?.supabase?.url || process.env.NEXT_PUBLIC_SUPABASE_URL
  // the cloud database is optional: when it is not set up there is nothing to check, and no variable name to show
  if (!url) return null
  try {
    const res = await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) })
    if (res.status < 500) return { ok: true, msg: later('doctor.db_ok') }
    return { ok: false, msg: later('doctor.db_error', { status: res.status }) }
  } catch {
    return { ok: false, msg: later('doctor.db_unreachable'), hint: later('doctor.db_check') }
  }
}

function checkDeps() {
  const required = ['node', 'npm', 'tmux', 'git']
  const optional = ['claude', 'pandoc', 'wkhtmltopdf', 'typst', 'python3']
  const results = []
  for (const cmd of required) {
    const v = cmdVersion(cmd)
    if (cmd === 'node' && v && nodeIsTooOld()) { results.push({ ok: false, msg: `node: ${v}`, hint: later('doctor.node_old') }); continue }
    results.push(v ? { ok: true, msg: `${cmd}: ${v}` } : { ok: false, msg: later('doctor.not_found', { cmd }), hint: later('doctor.install', { cmd }) })
  }
  for (const cmd of optional) {
    const v = cmdVersion(cmd)
    results.push(v ? { ok: true, msg: `${cmd}: ${v}` } : { skip: true, msg: later('doctor.not_found_optional', { cmd }) })
  }
  return results
}

// On Windows the wrapper tells the doctor, by JHT_HOST_WSL_MEMORY_ADVICE, the memory limit the setup would have set for WSL and did
// not because other WSL distributions are registered, while %USERPROFILE%\.wslconfig still has none: the container cannot read the host.
function checkWslMemory() {
  const value = process.env.JHT_HOST_WSL_MEMORY_ADVICE ?? ''
  if (!/^[1-9][0-9]?GB$/.test(value)) return null
  return { warn: true, msg: later('doctor.wsl_memory_unlimited'), hint: later('doctor.wsl_memory_hint', { value }) }
}

function checkWorkers() {
  try {
    const sessions = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' })
      .trim().split('\n').filter(Boolean)
    // tmux may hold the person's own sessions: only the team's count
    if (!sessions.some((s) => AGENTS.some((a) => isAgentSession(s, a)))) return [{ warn: true, msg: later('doctor.team_off'), hint: 'jht team start' }]
    const expected = ['assistente', 'capitano', 'mentor', 'sentinella']
    return expected.map(role => {
      const agent = AGENTS.find(a => a.role === role)
      const active = !!agent && sessions.some(s => isAgentSession(s, agent))
      const name = agent?.prefix ?? role.toUpperCase()
      return active
        ? { ok: true, msg: later('doctor.team_active', { name }) }
        : { warn: true, msg: later('doctor.team_missing', { name }), hint: `jht team start ${role}` }
    })
  } catch {
    // `tmux list-sessions` fails also when tmux is there but no session runs (no server): that is a team that is off
    if (cmdExists('tmux')) return [{ warn: true, msg: later('doctor.team_off'), hint: 'jht team start' }]
    return [{ skip: true, msg: later('doctor.tmux_missing') }]
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
    { title: later('doctor.sec_environment'), checks: [...depsCk, checkWslMemory()] },
    { title: later('doctor.sec_config'),      checks: [configCk] },
    { title: later('doctor.sec_provider'), checks: [providerCk, apiCk] },
    { title: later('doctor.sec_database'),    checks: [dbCk] },
    { title: later('doctor.sec_team'),        checks: workersCk },
  ].map((sec) => ({ ...sec, checks: sec.checks.filter(Boolean) })).filter((sec) => sec.checks.length > 0)
  // the checks hold their texts to be written later: a screen writes them in the person's language, the JSON in English
  const rows = sections.flatMap((sec) => sec.checks.map((ck) => ({ section: sec.title, status: kindOf(ck), message: ck.msg, hint: ck.hint ?? null })))
  const all = rows.map((x) => ({ ...x, section: show(x.section), message: show(x.message), hint: show(x.hint) }))
  const count = (status) => all.filter((x) => x.status === status).length
  const problems = count('fail'), warnings = count('warn'), fine = count('ok')
  if (problems > 0) process.exitCode = 1

  if (options.json) {
    console.log(JSON.stringify({ ok: problems === 0, summary: { ok: fine, warnings, problems }, checks: rows.map((x) => ({ ...x, section: show(x.section, 'en'), message: show(x.message, 'en'), hint: show(x.hint, 'en') })) }, null, 2))
    return
  }

  const parts = [say('doctor.ok', { n: fine })]
  if (warnings) parts.push(say(warnings === 1 ? 'doctor.warning_one' : 'doctor.warning_many', { n: warnings }))
  if (problems) parts.push(say(problems === 1 ? 'doctor.problem_one' : 'doctor.problem_many', { n: problems }))
  console.log(title(say('doctor.title'), parts.join(' · ')))

  if (options.all) {
    for (const sec of sections) {
      console.log(`  ${c.bold(show(sec.title))}`)
      for (const ck of sec.checks) console.log(statusLine(kindOf(ck), show(ck.msg), { hint: show(ck.hint), indent: 4 }))
      console.log('')
    }
  } else {
    const needs = all.filter((x) => x.status === 'fail' || x.status === 'warn')
    // the problems first, then the warnings
    for (const x of [...needs.filter((n) => n.status === 'fail'), ...needs.filter((n) => n.status === 'warn')]) {
      console.log(statusLine(x.status, x.message, { hint: x.hint }))
    }
    if (needs.length) console.log('')
    console.log(hint(say('doctor.every_check')))
    console.log('')
  }
  if (problems === 0 && warnings === 0) console.log(`  ${c.green(say('doctor.all_fine'))}\n`)
}

export function registerDoctorCommand(program) {
  program
    .command('doctor')
    .description(say('doctor.description'))
    .option('-a, --all', say('doctor.opt_all'))
    .option('--json', say('option.json'))
    .action(handleDoctor)
}
