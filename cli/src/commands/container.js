// Comando container — wrap di `docker compose` per il container jht
//
// Sottocomandi:
//   jht container up        docker compose up -d jht (con fix ownership .next)
//   jht container down      stop + rm del container (team muore, Assistente incluso)
//   jht container recreate  down + up (utile dopo bump immagine / compose edit)
//   jht container status    stato, immagine, mount, uptime
//   jht container logs [-f] docker logs del jht

import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containerRunning, CONTAINER_NAME, execInContainer } from '../utils/container-proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo root: cli/src/commands → up 3 livelli
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

function dockerCompose(args, { cwd = REPO_ROOT, inherit = true } = {}) {
  const r = spawnSync('docker', ['compose', ...args], {
    cwd,
    stdio: inherit ? 'inherit' : 'pipe',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return r.status === 0;
}

/**
 * Fix ownership del volume anonimo /app/web/.next dopo `up --no-start`.
 * Viene creato root-owned: il container gira come uid 1001 (jht) e la
 * prima compile Turbopack fallirebbe EACCES. Idem chown.
 * Usa un one-shot --volumes-from sulla stessa immagine.
 */
function fixNextOwnership() {
  const r = spawnSync('docker', [
    'run', '--rm', '--user', 'root', '--entrypoint', '/bin/sh',
    '--volumes-from', CONTAINER_NAME,
    'ghcr.io/leopu00/jht:latest',
    '-c', 'chown -R 1001:1001 /app/web/.next 2>/dev/null || true',
  ], {
    stdio: 'ignore',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return r.status === 0;
}

// Docker daemon reachable (un solo probe, non blocking).
function dockerDaemonReady() {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: 'pipe',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return r.status === 0;
}

// Su Windows, se Docker Desktop non gira lo lanciamo e aspettiamo il daemon.
// Su Linux/Mac se il daemon è down l'utente deve gestirlo (systemctl start docker,
// colima, ecc.): avviare processi non nostri in background sarebbe invasivo.
async function ensureDockerDaemon() {
  if (dockerDaemonReady()) return true;

  if (process.platform !== 'win32') {
    console.error(c.red('Docker daemon non raggiungibile. Avvialo prima di continuare.'));
    return false;
  }

  const candidates = [
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Docker\\Docker\\Docker Desktop.exe`,
    'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
  ].filter(Boolean);
  const exe = candidates.find(p => { try { return existsSync(p); } catch { return false; } });
  if (!exe) {
    console.error(c.red('Docker Desktop.exe non trovato nei path standard. Avvialo a mano.'));
    return false;
  }

  console.log(c.dim('  Docker daemon giu\', avvio Docker Desktop...'));
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore', shell: false }).unref();
  } catch (err) {
    console.error(c.red(`  Impossibile lanciare Docker Desktop: ${err.message}`));
    return false;
  }

  const timeoutMs = 90_000;
  const pollMs = 2000;
  const start = Date.now();
  process.stdout.write(c.dim('  Attendo daemon'));
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));
    process.stdout.write(c.dim('.'));
    if (dockerDaemonReady()) {
      process.stdout.write('\n');
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(c.green(`  ✓ Docker Desktop pronto (${elapsed}s)`));
      return true;
    }
  }
  process.stdout.write('\n');
  console.error(c.red(`  ✗ Docker Desktop non pronto dopo ${timeoutMs / 1000}s. Riprova a mano.`));
  return false;
}

// ── up ─────────────────────────────────────────────────────────────
async function upAction() {
  if (!(await ensureDockerDaemon())) process.exit(1);

  if (containerRunning()) {
    console.log(c.yellow(`Container '${CONTAINER_NAME}' gia' attivo.`));
    return;
  }
  console.log(c.bold('Avvio container jht...'));
  // Passo 1: create (senza avviare) per avere il volume anonimo .next
  if (!dockerCompose(['up', '--no-start', 'jht'])) {
    console.error(c.red('docker compose up --no-start fallito'));
    process.exit(1);
  }
  // Passo 2: chown del volume .next
  console.log(c.dim('  Fix ownership /app/web/.next...'));
  fixNextOwnership();
  // Passo 3: start
  if (!dockerCompose(['start', 'jht'])) {
    console.error(c.red('docker compose start fallito'));
    process.exit(1);
  }
  console.log(c.green(`✓ Container ${CONTAINER_NAME} avviato`));
  console.log(c.dim('  Web UI: http://localhost:3000  ·  logs: jht container logs -f'));
}

// ── down ───────────────────────────────────────────────────────────
function downAction() {
  if (!containerRunning()) {
    console.log(c.yellow(`Container '${CONTAINER_NAME}' non attivo.`));
    return;
  }
  console.log(c.bold('Fermo container jht...'));
  // compose stop preserva il container (ripartenza veloce con `up`)
  if (!dockerCompose(['stop', 'jht'])) {
    console.error(c.red('docker compose stop fallito'));
    process.exit(1);
  }
  console.log(c.green(`✓ Container ${CONTAINER_NAME} fermato (non rimosso)`));
  console.log(c.dim('  Per rimuoverlo: docker rm jht'));
}

// ── recreate ───────────────────────────────────────────────────────
async function recreateAction() {
  console.log(c.bold('Ricreo container jht (down + up)...'));
  if (containerRunning()) {
    spawnSync('docker', ['rm', '-f', CONTAINER_NAME], {
      stdio: 'ignore',
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    });
  }
  await upAction();
}

// ── status ─────────────────────────────────────────────────────────
function statusAction() {
  const inspect = spawnSync('docker', ['inspect', CONTAINER_NAME,
    '--format', '{{.State.Status}}|{{.Config.Image}}|{{.State.StartedAt}}|{{range $i,$m := .Mounts}}{{if $i}},{{end}}{{$m.Source}}:{{$m.Destination}}{{end}}',
  ], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

  if (inspect.status !== 0) {
    console.log(c.yellow(`Container '${CONTAINER_NAME}' non esiste.`));
    console.log(c.dim('  Crealo con: jht container up'));
    return;
  }
  const [state, image, startedAt, mounts] = inspect.stdout.trim().split('|');
  const running = state === 'running';
  const uptime = running ? (() => {
    const ms = Date.now() - new Date(startedAt).getTime();
    const min = Math.round(ms / 60_000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}min`;
  })() : '-';

  console.log('');
  console.log(`  ${c.bold('Container:')} ${CONTAINER_NAME}`);
  console.log(`  Stato:     ${running ? c.green(state) : c.red(state)}`);
  console.log(`  Immagine:  ${c.dim(image)}`);
  if (running) console.log(`  Uptime:    ${c.dim(uptime)}`);
  console.log(`  Mount:`);
  for (const m of mounts.split(',')) {
    console.log('    ' + c.dim(m));
  }
  console.log('');
}

// ── logs ───────────────────────────────────────────────────────────
function logsAction(options = {}) {
  if (!containerRunning()) {
    console.log(c.yellow(`Container '${CONTAINER_NAME}' non attivo.`));
    return;
  }
  const args = ['logs'];
  if (options.follow) args.push('-f');
  if (options.tail) args.push('--tail', String(options.tail));
  args.push(CONTAINER_NAME);
  const child = spawn('docker', args, {
    stdio: 'inherit',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

export function registerContainerCommand(program) {
  const cmd = new Command('container').description('Gestione container Docker jht');

  cmd.command('up').description('Avvia il container (via docker compose)').action(upAction);
  cmd.command('down').description('Ferma il container (preserva)').action(downAction);
  cmd.command('recreate').description('Rimuove e ricrea il container (perde tmux)').action(recreateAction);
  cmd.command('status').description('Stato container + mount').action(statusAction);
  cmd
    .command('logs')
    .description('Logs del container')
    .option('-f, --follow', 'segui in tempo reale', false)
    .option('-n, --tail <num>', 'ultime N righe', '50')
    .action(logsAction);

  program.addCommand(cmd);
}
