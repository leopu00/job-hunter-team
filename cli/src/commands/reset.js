import { rm, access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as clack from '@clack/prompts'
import pc from 'picocolors'
import { JHT_HOME } from '../jht-paths.js';
import { isInteractive } from './_colors.js'

/**
 * Spinner solo su TTY. [CLI-OUTPUT-NOT-MACHINE-SAFE]
 * Lo spinner di clack anima nascondendo il cursore (`\x1b[?25l`) e riscrivendo
 * la riga: sequenze che picocolors non disattiva perche' non sono colore.
 * Fuori dal terminale finiscono nel file o nella pipe del chiamante, quindi li
 * sostituiamo con due righe di log statiche.
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
const CREDS_DIR   = join(JHT_DIR, 'credentials')
const SESSIONS_DIR = join(JHT_DIR, 'sessions')

// ── Scope definitions ─────────────────────────────────────────────────────

const SCOPES = {
  config: {
    label:   'config — only jht.config.json',
    targets: [{ path: CONFIG_PATH, label: '~/.jht/jht.config.json', file: true }],
    warn:    'The configuration will be deleted. You will need to run jht setup.',
  },
  creds: {
    label:   'creds — config + credentials + sessions',
    targets: [
      { path: CONFIG_PATH,  label: '~/.jht/jht.config.json', file: true },
      { path: CREDS_DIR,    label: '~/.jht/credentials/',    dir: true },
      { path: SESSIONS_DIR, label: '~/.jht/sessions/',       dir: true },
    ],
    warn:    'Configuration and credentials will be deleted. The workspace will be preserved.',
  },
  full: {
    label:   'full — all ~/.jht/',
    targets: [{ path: JHT_DIR, label: '~/.jht/', dir: true }],
    warn:    pc.red('WARNING: ALL of ~/.jht/ will be permanently deleted.'),
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function pathExists(p) {
  try { await access(p); return true } catch { return false }
}

async function countFiles(dir) {
  try {
    const entries = await readdir(dir, { recursive: true })
    return entries.length
  } catch { return 0 }
}

async function buildDeleteList(targets) {
  const list = []
  for (const t of targets) {
    const exists = await pathExists(t.path)
    if (!exists) { list.push({ ...t, exists: false }); continue }
    if (t.dir) {
      const n = await countFiles(t.path)
      list.push({ ...t, exists: true, detail: `${n} file` })
    } else {
      list.push({ ...t, exists: true })
    }
  }
  return list
}

async function executeReset(targets) {
  const deleted = [], skipped = []
  for (const t of targets) {
    if (!(await pathExists(t.path))) { skipped.push(t.label); continue }
    await rm(t.path, { recursive: true, force: true })
    deleted.push(t.label)
  }
  return { deleted, skipped }
}

// ── Main handler ──────────────────────────────────────────────────────────

// Ogni uscita anticipata e' `process.exitCode` + `return`, mai `process.exit()`.
// Qui il motivo e' piu' concreto che altrove: l'ultima cosa che ogni ramo fa e'
// un `clack.outro(...)`, cioe' una scrittura sul terminale che dice all'utente
// se il reset e' stato eseguito o annullato. `process.exit()` sulla riga
// successiva puo' troncarla, e su un comando distruttivo la riga che dice
// "Annullato" e' esattamente quella che non si puo' perdere. I codici osservati
// non cambiano: 1 sugli errori d'uso, 0 sull'annullamento volontario.
// Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
async function handleReset(opts) {
  clack.intro(pc.bold('JHT — Reset'))

  // ── Scope resolution ──────────────────────────────────────────────────

  let scopeKey = opts.scope

  if (!scopeKey) {
    if (opts.nonInteractive) {
      clack.log.error('--scope required in --non-interactive mode')
      clack.outro(pc.red('Cancelled'))
      process.exitCode = 1
      return
    }
    scopeKey = await clack.select({
      message: 'Select the reset scope',
      options: Object.entries(SCOPES).map(([value, s]) => ({ value, label: s.label })),
      initialValue: 'config',
    })
    if (clack.isCancel(scopeKey)) { clack.outro(pc.dim('Cancelled')); return }
  }

  const scope = SCOPES[scopeKey]
  if (!scope) {
    clack.log.error(`Invalid scope: ${scopeKey}. Values: config | creds | full`)
    clack.outro(pc.red('Cancelled')); process.exitCode = 1; return
  }

  // ── Build delete list ─────────────────────────────────────────────────

  const list = await buildDeleteList(scope.targets)
  const toDelete = list.filter(t => t.exists)

  if (!toDelete.length) {
    clack.log.info('No files to be deleted — already clean.')
    clack.outro(pc.dim('Nothing to do')); return
  }

  // ── Show preview ──────────────────────────────────────────────────────

  clack.log.warn(scope.warn)
  clack.log.message(pc.bold('Files that will be deleted:'))
  for (const t of list) {
    if (t.exists)
      clack.log.message(`  ${pc.red('✗')} ${t.label}${t.detail ? pc.dim(` (${t.detail})`) : ''}`)
    else
      clack.log.message(`  ${pc.dim('—')} ${t.label} ${pc.dim('(not found)')}`)
  }

  // ── Confirm ───────────────────────────────────────────────────────────

  let confirmed = false
  if (opts.nonInteractive) {
    confirmed = !!opts.confirmReset
    if (!confirmed) {
      clack.log.error('--non-interactive requires --confirm-reset')
      clack.outro(pc.red('Cancelled')); process.exitCode = 1; return
    }
  } else {
    const ans = await clack.confirm({
      message: `Confirm deletion for scope ${pc.bold(scopeKey)}?`,
      initialValue: false,
    })
    if (clack.isCancel(ans) || !ans) { clack.outro(pc.dim('Cancelled')); return }
    confirmed = true
  }

  // ── Execute ───────────────────────────────────────────────────────────

  const s = spinner()
  s.start('Deletion in progress...')
  const { deleted, skipped } = await executeReset(scope.targets)
  s.stop('Deletion completed')

  for (const d of deleted) clack.log.success(`Deleted: ${d}`)
  for (const sk of skipped) clack.log.info(pc.dim(`Skipped (not found): ${sk}`))

  clack.outro(pc.green(`Reset ${scopeKey} completed — run jht setup to reconfigure`))
}

// ── Registration ──────────────────────────────────────────────────────────

export function registerResetCommand(program) {
  program
    .command('reset')
    .description('Reset configuration — config | creds | full')
    .option('--scope <scope>', 'Scope: config | creds | full')
    .option('--non-interactive', 'Non-interactive mode')
    .option('--confirm-reset', 'confirm reset in --non-interactive mode')
    .action(handleReset)
}
