// Comando container — wrap di `docker compose` per il container jht
//
// Sottocomandi:
//   jht container up        docker compose up -d jht (create, start)
//   jht container down      stop del container, senza rimuoverlo (team muore, Assistente incluso)
//   jht container recreate  down + up (utile dopo bump immagine / compose edit)
//   jht container status    stato, immagine, mount, uptime
//   jht container logs [-f] docker logs del jht

import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containerRunning, CONTAINER_NAME, execInContainer } from '../utils/container-proxy.js';
import { c } from './_colors.js';
import { resumeTelegram } from '../lib/telegram-lifecycle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo root: cli/src/commands → up 3 livelli
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
// Tenuta dal gate di pin dell'immagine (scripts/runtime_image_pin.py): non cancellarla.
const DEFAULT_RUNTIME_IMAGE = 'ghcr.io/leopu00/jht@sha256:b48f45f4d3d6313768a3fb7ff56d0b9db4470440f1e2110e335f4290f4d9eb1c';

function dockerCompose(args, { cwd = REPO_ROOT, inherit = true } = {}) {
  const r = spawnSync('docker', ['compose', ...args], {
    cwd,
    stdio: inherit ? 'inherit' : 'pipe',
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

// Dalla 0.4 JHT gira solo su Podman (una macchina sul Mac e su Windows, rootless su Linux). Il motore lo accende `jht up`
// del wrapper installato; da qui non si avvia niente (ne' Colima ne' Docker Desktop): si dice solo cosa fare.
async function ensureDockerDaemon() {
  if (dockerDaemonReady()) return true;
  const hint = process.platform === 'linux'
    ? "JHT runs on rootless Podman: check it with 'podman info'."
    : "JHT runs on Podman: start its machine with 'podman machine start jht-podman', or run 'jht up'.";
  console.error(c.red(`The container engine cannot be reached. ${hint}`));
  return false;
}

// ── up ─────────────────────────────────────────────────────────────
// Ogni fallimento segna `process.exitCode` e RITORNA. Il `return` non e'
// cosmetico: con `process.exit()` la funzione non proseguiva mai, e i due passi
// di `up` (create → start) sono in sequenza — senza il `return` un
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
    if (!resumeTelegram({ cwd: REPO_ROOT })) {
      console.error(c.red('Telegram lifecycle reconciliation failed'));
      process.exitCode = 1;
      return;
    }
    console.log(c.yellow(`Container '${CONTAINER_NAME}' is already active.`));
    return;
  }
  console.log(c.bold('Starting the jht container...'));
  // Passo 1: create (senza avviare)
  if (!dockerCompose(['up', '--no-start', 'jht'])) {
    console.error(c.red('docker compose up failed --no-start'));
    process.exitCode = 1;
    return;
  }
  // Passo 2: start
  if (!dockerCompose(['start', 'jht'])) {
    console.error(c.red('docker compose start failed'));
    process.exitCode = 1;
    return;
  }
  if (!resumeTelegram({ cwd: REPO_ROOT })) { process.exitCode = 1; return; }
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
const CONTAINER_NAME_PATTERN = CONTAINER_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MISSING_INSPECT = new RegExp(`^(?:Error response from daemon: )?No such (?:object|container): ${CONTAINER_NAME_PATTERN}$`);

export function classifyContainerInspect(inspect) {
  if (inspect?.status === 1 && !inspect.error && typeof inspect.stderr === 'string' && MISSING_INSPECT.test(inspect.stderr.trim())) {
    return { kind: 'missing' };
  }
  if (inspect?.status !== 0 || typeof inspect?.stdout !== 'string') return { kind: 'unknown' };
  const fields = inspect.stdout.trim().split('|');
  if (fields.length !== 4) return { kind: 'unknown' };
  const [rawState, image, startedAt, mounts] = fields;
  if (!image) return { kind: 'unknown' };
  const state = rawState === 'running' ? 'running' : (rawState === 'exited' || rawState === 'stopped' ? 'stopped' : null);
  if (!state || (state === 'running' && Number.isNaN(new Date(startedAt).getTime()))) return { kind: 'unknown' };
  return { kind: state, image, startedAt, mounts };
}

export function statusAction({ inspectRunner = spawnSync, write = console.log, setExitCode = (code) => { process.exitCode = code; }, now = Date.now } = {}) {
  const inspect = inspectRunner('docker', ['inspect', CONTAINER_NAME,
    '--format', '{{.State.Status}}|{{.Config.Image}}|{{.State.StartedAt}}|{{range $i,$m := .Mounts}}{{if $i}},{{end}}{{$m.Source}}:{{$m.Destination}}{{end}}',
  ], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  const result = classifyContainerInspect(inspect);

  if (result.kind === 'unknown') {
    write(c.yellow(`Container '${CONTAINER_NAME}' status is unknown.`));
    write(c.dim('  Inspect did not return a trustworthy container state.'));
    setExitCode(1);
    return result;
  }
  if (result.kind === 'missing') {
    write(c.yellow(`Container '${CONTAINER_NAME}' is missing.`));
    return result;
  }

  const uptime = result.kind === 'running' ? (() => {
    const min = Math.round((now() - new Date(result.startedAt).getTime()) / 60_000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}min`;
  })() : '-';
  write('');
  write(`  ${c.bold('Container:')} ${CONTAINER_NAME}`);
  write(`  State:     ${result.kind === 'running' ? c.green(result.kind) : c.red(result.kind)}`);
  write(`  Image:     ${c.dim(result.image)}`);
  if (result.kind === 'running') write(`  Uptime:    ${c.dim(uptime)}`);
  write('  Mounts:');
  if (result.mounts) {
    for (const mount of result.mounts.split(',')) write('    ' + c.dim(mount));
  }
  write('');
  return result;
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
