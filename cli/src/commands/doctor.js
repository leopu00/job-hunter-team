import { readFile, access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import * as clack from '@clack/prompts'
import pc from 'picocolors'

const JHT_DIR     = join(homedir(), '.jht')
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json')

// ── Helpers ──────────────────────────────────────────────────────────────

async function fileExists(p) {
  try { await access(p); return true } catch { return false }
}

function cmdVersion(cmd) {
  try { return execSync(`${cmd} --version 2>/dev/null`, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0] }
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
  if (major < 18) return { ok: false, msg: `Node ${v}`, hint: 'Richiesto Node ≥18' }
  return { ok: true, msg: `Node ${v}` }
}

async function checkConfig() {
  if (!(await fileExists(CONFIG_PATH))) return { ok: false, msg: 'jht.config.json non trovato', hint: 'Esegui: jht setup' }
  const cfg = await readConfigAsync()
  if (!cfg) return { ok: false, msg: 'Config JSON non valido', hint: 'Esegui: jht setup --reset' }
  const v = cfg.version ?? 1
  if (v < 4) return { warn: true, msg: `Config v${v} — aggiornamento disponibile`, hint: 'Esegui: jht migrate' }
  return { ok: true, msg: `Config v${v} valida` }
}

async function checkProvider() {
  const cfg = await readConfigAsync()
  if (!cfg) return { ok: false, msg: 'Provider — config mancante' }
  const active = cfg.active_provider
  if (!active) return { warn: true, msg: 'Nessun provider attivo', hint: 'Esegui: jht config set active_provider anthropic' }
  const prov = cfg.providers?.[active]
  const key = prov?.api_key || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
  if (!key && prov?.auth_method !== 'cli') return { warn: true, msg: `Provider ${active} senza API key`, hint: `Imposta ${active.toUpperCase()}_API_KEY` }
  return { ok: true, msg: `Provider: ${active}${prov?.model ? ` (${prov.model})` : ''}` }
}

async function checkApiKey() {
  const cfg = await readConfigAsync()
  const key = cfg?.providers?.anthropic?.api_key || process.env.ANTHROPIC_API_KEY
  if (!key) return { skip: true, msg: 'Test API — nessuna key Anthropic trovata' }
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return { ok: true, msg: 'Anthropic API key valida' }
    if (res.status === 401) return { ok: false, msg: 'Anthropic API key non valida (401)', hint: 'Aggiorna ANTHROPIC_API_KEY' }
    return { warn: true, msg: `Anthropic API risposta ${res.status}` }
  } catch (e) {
    if (e.name === 'TimeoutError') return { warn: true, msg: 'Anthropic API timeout (>5s)' }
    return { warn: true, msg: 'Anthropic API non raggiungibile' }
  }
}

async function checkDatabase() {
  const cfg = await readConfigAsync()
  const url = cfg?.supabase?.url || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return { skip: true, msg: 'Database — SUPABASE_URL non configurata' }
  try {
    const res = await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) })
    if (res.status < 500) return { ok: true, msg: `Database Supabase raggiungibile` }
    return { ok: false, msg: `Database Supabase errore ${res.status}` }
  } catch {
    return { ok: false, msg: 'Database Supabase non raggiungibile', hint: 'Verifica SUPABASE_URL e connessione' }
  }
}

function checkDeps() {
  const required = ['node', 'npm', 'tmux', 'git']
  const optional = ['claude', 'pandoc', 'typst', 'python3']
  const results = []
  for (const cmd of required) {
    const v = cmdVersion(cmd)
    results.push(v ? { ok: true, msg: `${cmd}: ${v}` } : { ok: false, msg: `${cmd}: non trovato`, hint: `Installa ${cmd}` })
  }
  for (const cmd of optional) {
    const v = cmdVersion(cmd)
    results.push(v ? { ok: true, msg: `${cmd}: ${v}` } : { skip: true, msg: `${cmd}: non trovato (opzionale)` })
  }
  return results
}

function checkWorkers() {
  try {
    const sessions = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' })
      .trim().split('\n').filter(Boolean)
    if (!sessions.length) return [{ warn: true, msg: 'Nessuna sessione tmux attiva', hint: 'Avvia i worker con il Coordinatore' }]
    const expected = ['JHT-GATEKEEPER', 'JHT-COORD', 'JHT-FRONTEND']
    return expected.map(name => {
      const active = sessions.some(s => s.startsWith(name))
      return active
        ? { ok: true, msg: `${name}: attivo` }
        : { warn: true, msg: `${name}: non trovato`, hint: `Avvia sessione tmux ${name}` }
    })
  } catch {
    return [{ skip: true, msg: 'tmux non disponibile — verifica workers manuale' }]
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

  const s = clack.spinner()

  s.start('Verifica in corso…')

  const [nodeCk, configCk, providerCk, apiCk, dbCk, depsCk, workersCk] = await Promise.all([
    checkNode(), checkConfig(), checkProvider(), checkApiKey(),
    checkDatabase(), Promise.resolve(checkDeps()), Promise.resolve(checkWorkers()),
  ])

  s.stop('Diagnosi completata')

  const sections = [
    { title: 'Ambiente',    checks: [nodeCk, ...depsCk] },
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
    clack.outro(pc.red(`${errors} errori da risolvere — esegui i fix suggeriti`))
  else if (warnings > 0)
    clack.outro(pc.yellow(`${warnings} avvisi — sistema funzionante con limitazioni`))
  else
    clack.outro(pc.green('Tutto OK — sistema pronto'))
}

export function registerDoctorCommand(program) {
  program
    .command('doctor')
    .description('Verifica setup — config, provider, API key, DB, workers')
    .action(handleDoctor)
}
