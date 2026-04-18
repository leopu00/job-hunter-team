import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { platform } from 'node:os';
import { isContainer } from '../../../shared/runtime/container.js';

const DEFAULT_PORT = 3000;
const DEFAULT_URL  = `http://localhost:${DEFAULT_PORT}`;

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

function getRepoRoot() {
  try { return execSync('git rev-parse --show-toplevel 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const conn = createConnection({ port, host: '127.0.0.1' });
    conn.on('connect', () => { conn.destroy(); resolve(true); });
    conn.on('error', () => { resolve(false); });
    conn.setTimeout(1000, () => { conn.destroy(); resolve(false); });
  });
}

function openBrowser(url) {
  if (isContainer()) return false;
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  try { execSync(`${cmd} "${url}" 2>/dev/null`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

async function findWebDir() {
  const root = getRepoRoot();
  if (root) {
    const webDir = join(root, 'web');
    if (await fileExists(join(webDir, 'package.json'))) return webDir;
  }
  // Fallback: cwd (utile in container, dove .git non e' presente)
  if (await fileExists(join(process.cwd(), 'web', 'package.json'))) return join(process.cwd(), 'web');
  // Fallback: /app/web (Dockerfile WORKDIR)
  if (await fileExists('/app/web/package.json')) return '/app/web';
  return null;
}

function startNextDev(webDir, port) {
  // In container bypass npm and exec next directly so docker stop
  // delivers SIGTERM to the actual Next.js process (npm doesn't
  // forward signals reliably and we'd hit SIGKILL after the 10s
  // grace period). Bind to 0.0.0.0 so the host port-forward hits us.
  if (isContainer()) {
    const nextBin = join(webDir, 'node_modules', '.bin', 'next');
    const child = spawn(nextBin, ['dev', '-p', String(port), '-H', '0.0.0.0'], {
      cwd: webDir,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port), HOSTNAME: '0.0.0.0' },
    });
    return child;
  }
  const child = spawn('npm', ['run', 'dev', '--', '-p', String(port)], {
    cwd: webDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();
  return child;
}

async function waitForReady(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function handleDashboard(options) {
  const port = parseInt(options.port ?? String(DEFAULT_PORT), 10) || DEFAULT_PORT;
  const url = `http://localhost:${port}`;

  console.log(`\n  ${BOLD}JHT — Dashboard${RESET}\n`);

  // Controlla se la porta è già in uso (dashboard già attiva)
  const alreadyRunning = await isPortOpen(port);

  if (alreadyRunning) {
    console.log(`  ${GREEN}●${RESET}  Dashboard già attiva su ${GREEN}${url}${RESET}`);
    if (options.browser !== false && !isContainer()) {
      const opened = openBrowser(url);
      if (opened) console.log(`  ${DIM}Browser aperto.${RESET}`);
    }
    console.log('');
    return;
  }

  // Trova directory web
  const webDir = await findWebDir();
  if (!webDir) {
    console.error('  Directory web/ non trovata. Assicurati di essere nel repo JHT.');
    process.exitCode = 1;
    return;
  }

  // Verifica che npm install sia stato eseguito
  if (!(await fileExists(join(webDir, 'node_modules')))) {
    console.log(`  ${DIM}Installazione dipendenze web...${RESET}`);
    try {
      execSync('npm install --silent', { cwd: webDir, stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`  ${GREEN}✓${RESET}  Dipendenze installate`);
    } catch {
      console.error('  npm install fallito nella directory web/');
      process.exitCode = 1;
      return;
    }
  }

  // Avvia next dev in background
  console.log(`  ${DIM}Avvio Next.js dev server sulla porta ${port}...${RESET}`);
  const child = startNextDev(webDir, port);

  child.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('EADDRINUSE')) {
      console.error(`  \x1b[31mPorta ${port} già in uso da un altro processo.\x1b[0m`);
      console.error(`  ${DIM}Prova: jht dashboard --port ${port + 1}${RESET}\n`);
    }
  });

  // Aspetta che il server sia pronto
  const ready = await waitForReady(port);

  if (ready) {
    console.log(`  ${GREEN}●${RESET}  Dashboard avviata su ${GREEN}${url}${RESET}`);
    console.log(`  ${DIM}PID: ${child.pid}${isContainer() ? ' (foreground)' : ' (in background)'}${RESET}`);
    // commander --no-browser sets options.browser=false (no options.noBrowser).
    if (options.browser !== false && !isContainer()) {
      const opened = openBrowser(url);
      if (opened) console.log(`  ${DIM}Browser aperto.${RESET}`);
    }
    if (!isContainer()) {
      console.log(`\n  ${DIM}Per fermare: kill ${child.pid}${RESET}\n`);
    }
  } else {
    console.log(`  ${YELLOW}Server avviato ma non ancora pronto (PID: ${child.pid}).${RESET}`);
    console.log(`  ${DIM}Apri manualmente: ${url}${RESET}\n`);
  }

  // Boot the assistant in the background so the first thing the user
  // sees on /dashboard → /onboarding is the welcome chat. Only inside
  // the container — on the host, team/start is the user-initiated
  // entry point. Non-fatal if the script or tmux isn't there yet.
  if (isContainer() && ready) {
    try {
      const root = '/app';
      const startScript = join(root, '.launcher', 'start-agent.sh');
      if (await fileExists(startScript)) {
        const boot = spawn('bash', [startScript, 'assistente'], {
          detached: true,
          stdio: 'ignore',
        });
        boot.unref();
        console.log(`  ${DIM}Assistente: avvio in background…${RESET}`);
      }
    } catch { /* non-fatal */ }
  }

  // In container PID 1 (this process) must stay alive: if we exit,
  // docker tears the whole runtime down. Forward signals and wait
  // for the next dev child indefinitely.
  if (isContainer()) {
    const forward = (sig) => {
      try { child.kill(sig); } catch { /* ignore */ }
    };
    process.on('SIGINT', () => forward('SIGINT'));
    process.on('SIGTERM', () => forward('SIGTERM'));
    await new Promise((resolve) => {
      child.once('exit', (code) => {
        process.exitCode = code ?? 0;
        resolve();
      });
    });
  }
}

export function registerDashboardCommand(program) {
  program
    .command('dashboard')
    .alias('web')
    .description('Avvia la dashboard web e apri il browser')
    .option('-p, --port <port>', 'porta (default 3000)', String(DEFAULT_PORT))
    .option('--no-browser', 'non aprire il browser automaticamente')
    .action(handleDashboard);
}
