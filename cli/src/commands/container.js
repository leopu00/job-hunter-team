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
import { c } from './_colors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo root: cli/src/commands → up 3 livelli
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

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
    'ghcr.io/leopu00/jht:0.3.8',
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
    const hint = process.platform === 'darwin'
      ? "Start it with 'colima start' or 'open -a Docker' (Docker Desktop)."
      : "Start it (for example, 'systemctl start docker').";
    console.error(c.red(`Docker daemon cannot be reached. ${hint}`));
    return false;
  }

  const candidates = [
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Docker\\Docker\\Docker Desktop.exe`,
    'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
  ].filter(Boolean);
  const exe = candidates.find(p => { try { return existsSync(p); } catch { return false; } });
  if (!exe) {
    console.error(c.red('Docker Desktop.exe was not found in the standard locations. Start it manually.'));
    return false;
  }

  console.log(c.dim('  Docker daemon is down; starting Docker Desktop...'));
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore', shell: false }).unref();
  } catch (err) {
    console.error(c.red(`  Can't launch Docker Desktop: ${err.message}`));
    return false;
  }

  const timeoutMs = 90_000;
  const pollMs = 2000;
  const start = Date.now();
  process.stdout.write(c.dim('  Waiting for the daemon'));
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));
    process.stdout.write(c.dim('.'));
    if (dockerDaemonReady()) {
      process.stdout.write('\n');
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(c.green(`  ✓ Docker Desktop ready (${elapsed}s)`));
      return true;
    }
  }
  process.stdout.write('\n');
  console.error(c.red(`  Docker Desktop was not ready after ${timeoutMs / 1000}s. Try again manually.`));
  return false;
}

// ── up ─────────────────────────────────────────────────────────────
// Ogni fallimento segna `process.exitCode` e RITORNA. Il `return` non e'
// cosmetico: con `process.exit()` la funzione non proseguiva mai, e i tre passi
// di `up` (create → chown → start) sono in sequenza — senza il `return` un
// `docker compose up --no-start` fallito lascerebbe partire lo `start` su un
// container che non esiste. `recreateAction` fa `await upAction()` come ultima
// istruzione, quindi nemmeno da li' resta codice da saltare.
// Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
async function upAction() {
  if (!(await ensureDockerDaemon())) {
    process.exitCode = 1;
    return;
  }

  if (containerRunning()) {
    console.log(c.yellow(`Container '${CONTAINER_NAME}' is already active.`));
    return;
  }
  console.log(c.bold('Starting the jht container...'));
  // Passo 1: create (senza avviare) per avere il volume anonimo .next
  if (!dockerCompose(['up', '--no-start', 'jht'])) {
    console.error(c.red('docker compose up failed --no-start'));
    process.exitCode = 1;
    return;
  }
  // Passo 2: chown del volume .next
  console.log(c.dim('  Fix ownership /app/web/.next...'));
  fixNextOwnership();
  // Passo 3: start
  if (!dockerCompose(['start', 'jht'])) {
    console.error(c.red('docker compose start failed'));
    process.exitCode = 1;
    return;
  }
  console.log(c.green(`✓ Container ${CONTAINER_NAME} started`));
  console.log(c.dim('  Interaction: JHT desktop app · logs: jht container logs -f'));
}

// ── down ───────────────────────────────────────────────────────────
function downAction() {
  if (!containerRunning()) {
    console.log(c.yellow(`Container '${CONTAINER_NAME}' is not active.`));
    return;
  }
  console.log(c.bold('Stopping the jht container...'));
  // compose stop preserva il container (ripartenza veloce con `up`)
  if (!dockerCompose(['stop', 'jht'])) {
    console.error(c.red('docker compose stop failed'));
    process.exitCode = 1;
    return;
  }
  console.log(c.green(`✓ Container ${CONTAINER_NAME} stopped (not removed)`));
  console.log(c.dim('  To remove it: docker rm jht'));
}

// ── recreate ───────────────────────────────────────────────────────
async function recreateAction() {
  console.log(c.bold('Recreating the jht container (down + up)...'));
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
    console.log(c.yellow(`Container '${CONTAINER_NAME}' does not exist.`));
    console.log(c.dim('  Create it with: jht container up'));
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
  console.log(`  State:     ${running ? c.green(state) : c.red(state)}`);
  console.log(`  Image:     ${c.dim(image)}`);
  if (running) console.log(`  Uptime:    ${c.dim(uptime)}`);
  console.log('  Mounts:');
  for (const m of mounts.split(',')) {
    console.log('    ' + c.dim(m));
  }
  console.log('');
}

// ── logs ───────────────────────────────────────────────────────────
function logsAction(options = {}) {
  if (!containerRunning()) {
    console.log(c.yellow(`Container '${CONTAINER_NAME}' is not active.`));
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
  // Qui `process.exit()` RESTA, a differenza del resto del file. `logs -f` e'
  // long-running e passa `stdio: 'inherit'`: non c'e' nulla di nostro in un
  // buffer da drenare (scrive direttamente il figlio), quindi la conversione non
  // guadagnerebbe nulla, e propagare l'uscita di un figlio interattivo tramite
  // `process.exitCode` dipende dal fatto che nessun handle resti aperto — un
  // rischio di appendere il comando in cambio di zero. Vedi
  // [CLI-NO-GLOBAL-ERROR-HANDLER].
  child.on('exit', (code) => process.exit(code ?? 0));
}

export function registerContainerCommand(program) {
  const cmd = new Command('container').description('Manage the jht Docker container');

  cmd.command('up').description('Start the container (via docker compose)').action(upAction);
  cmd.command('down').description('Stop the container (preserve)').action(downAction);
  cmd.command('recreate').description('Remove and recreate the container (tmux sessions are lost)').action(recreateAction);
  cmd.command('status').description('Container status + mount').action(statusAction);
  cmd
    .command('logs')
    .description('Container logs')
    .option('-f, --follow', 'follow in real time', false)
    .option('-n, --tail <num>', 'last N rows', '50')
    .action(logsAction);

  program.addCommand(cmd);
}
