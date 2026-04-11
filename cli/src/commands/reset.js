import { rm, access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as clack from '@clack/prompts'
import pc from 'picocolors'
import { JHT_HOME } from '../jht-paths.js';

const JHT_DIR     = JHT_HOME
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json')
const CREDS_DIR   = join(JHT_DIR, 'credentials')
const SESSIONS_DIR = join(JHT_DIR, 'sessions')

// ── Scope definitions ─────────────────────────────────────────────────────

const SCOPES = {
  config: {
    label:   'config — solo jht.config.json',
    targets: [{ path: CONFIG_PATH, label: '~/.jht/jht.config.json', file: true }],
    warn:    'La configurazione verrà eliminata. Dovrai eseguire jht setup.',
  },
  creds: {
    label:   'creds — config + credenziali + sessioni',
    targets: [
      { path: CONFIG_PATH,  label: '~/.jht/jht.config.json', file: true },
      { path: CREDS_DIR,    label: '~/.jht/credentials/',    dir: true },
      { path: SESSIONS_DIR, label: '~/.jht/sessions/',       dir: true },
    ],
    warn:    'Config e credenziali verranno eliminate. Il workspace verrà conservato.',
  },
  full: {
    label:   'full — tutto ~/.jht/',
    targets: [{ path: JHT_DIR, label: '~/.jht/', dir: true }],
    warn:    pc.red('ATTENZIONE: TUTTO ~/.jht/ verrà eliminato in modo permanente.'),
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

async function handleReset(opts) {
  clack.intro(pc.bold('JHT — Reset'))

  // ── Scope resolution ──────────────────────────────────────────────────

  let scopeKey = opts.scope

  if (!scopeKey) {
    if (opts.nonInteractive) {
      clack.log.error('--scope richiesto in modalità --non-interactive')
      clack.outro(pc.red('Annullato'))
      process.exit(1)
    }
    scopeKey = await clack.select({
      message: 'Seleziona scope reset',
      options: Object.entries(SCOPES).map(([value, s]) => ({ value, label: s.label })),
      initialValue: 'config',
    })
    if (clack.isCancel(scopeKey)) { clack.outro(pc.dim('Annullato')); process.exit(0) }
  }

  const scope = SCOPES[scopeKey]
  if (!scope) {
    clack.log.error(`Scope non valido: ${scopeKey}. Valori: config | creds | full`)
    clack.outro(pc.red('Annullato')); process.exit(1)
  }

  // ── Build delete list ─────────────────────────────────────────────────

  const list = await buildDeleteList(scope.targets)
  const toDelete = list.filter(t => t.exists)

  if (!toDelete.length) {
    clack.log.info('Nessun file da eliminare — già pulito.')
    clack.outro(pc.dim('Niente da fare')); return
  }

  // ── Show preview ──────────────────────────────────────────────────────

  clack.log.warn(scope.warn)
  clack.log.message(pc.bold('File che verranno eliminati:'))
  for (const t of list) {
    if (t.exists)
      clack.log.message(`  ${pc.red('✗')} ${t.label}${t.detail ? pc.dim(` (${t.detail})`) : ''}`)
    else
      clack.log.message(`  ${pc.dim('—')} ${t.label} ${pc.dim('(non trovato)')}`)
  }

  // ── Confirm ───────────────────────────────────────────────────────────

  let confirmed = false
  if (opts.nonInteractive) {
    confirmed = !!opts.confirmReset
    if (!confirmed) {
      clack.log.error('In --non-interactive richiede --confirm-reset')
      clack.outro(pc.red('Annullato')); process.exit(1)
    }
  } else {
    const ans = await clack.confirm({
      message: `Confermi eliminazione scope ${pc.bold(scopeKey)}?`,
      initialValue: false,
    })
    if (clack.isCancel(ans) || !ans) { clack.outro(pc.dim('Annullato')); process.exit(0) }
    confirmed = true
  }

  // ── Execute ───────────────────────────────────────────────────────────

  const s = clack.spinner()
  s.start('Eliminazione in corso…')
  const { deleted, skipped } = await executeReset(scope.targets)
  s.stop('Eliminazione completata')

  for (const d of deleted) clack.log.success(`Eliminato: ${d}`)
  for (const sk of skipped) clack.log.info(pc.dim(`Saltato (non trovato): ${sk}`))

  clack.outro(pc.green(`Reset ${scopeKey} completato — esegui jht setup per riconfigurare`))
}

// ── Registration ──────────────────────────────────────────────────────────

export function registerResetCommand(program) {
  program
    .command('reset')
    .description('Reset configurazione — config | creds | full')
    .option('--scope <scope>', 'Scope: config | creds | full')
    .option('--non-interactive', 'Modalità non interattiva')
    .option('--confirm-reset', 'Conferma reset in --non-interactive')
    .action(handleReset)
}
