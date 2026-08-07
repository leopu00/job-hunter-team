// cli/src/utils/container-proxy.js
// Proxy helper verso il container `jht`.
//
// Due modalita' di funzionamento:
//
// 1. CLI gira sull'HOST (path "from source" o `--no-docker`):
//    le funzioni proxano via `docker exec jht ...` verso il container
//    long-running.
//
// 2. CLI gira DENTRO al container (path Docker via wrapper bash):
//    le funzioni eseguono i comandi localmente senza docker exec —
//    siamo gia' nel posto giusto.
//
// La domanda «sono nel container?» ha UNA sola risposta in tutto il repo:
// `isContainer()` di shared/runtime/container.js (IS_CONTAINER=1 oppure
// /.dockerenv). Prima ne circolavano tre versioni divergenti — env var qui,
// `existsSync('/app/shared/skills')` in burn/standby/working-hours — e un
// comando funzionava o no a seconda di quale file lo implementava.
//
// ESM: il package cli/ ha "type": "module".
//
// Su Windows con git-bash, MSYS_NO_PATHCONV=1 serve quando il comando
// contiene path POSIX (es. `/app/.launcher/start-agent.sh`) per evitare
// la conversione automatica di /foo in C:\Program Files\Git\foo.

import { spawn, spawnSync } from 'node:child_process';
import { isContainer } from '../../../shared/runtime/container.js';

export const CONTAINER_NAME = process.env.JHT_CONTAINER_NAME || 'jht';

export function dockerAvailable() {
  if (isContainer()) return true;
  const r = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

export function containerRunning(name = CONTAINER_NAME) {
  if (isContainer()) return name === CONTAINER_NAME;
  if (!dockerAvailable()) return false;
  const r = spawnSync('docker', ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  return r.status === 0 && r.stdout.trim() === name;
}

function unreachable(container) {
  return {
    ok: false,
    stdout: '',
    stderr: `container '${container}' non raggiungibile dall'interno di '${CONTAINER_NAME}'`,
    code: -1,
  };
}

function notRunning(container) {
  return { ok: false, stdout: '', stderr: `container '${container}' is not running`, code: -1 };
}

function toResult(r) {
  return {
    ok: r.status !== null,
    stdout: (r.stdout || '').toString(),
    stderr: (r.stderr || '').toString(),
    code: r.status ?? -1,
  };
}

/**
 * Runner unico: esegue un argv nel container target SENZA passare da una
 * shell — gli argomenti arrivano al processo esatti come sono, quindi non
 * esiste quoting da sbagliare (apici, `$`, backtick, newline nel testo
 * scritto dall'utente).
 *
 * - Sull'host: `docker exec [-i|-d] [-e K=V ...] <container> <argv...>`
 * - In-container: spawn diretto di `argv[0]` con `env` mergiato.
 *
 * Ritorna { ok, stdout, stderr, code }. Il codice d'uscita del processo
 * interno e' preservato — il chiamante puo' distinguere fallimento del
 * trasporto (ok=false) da fallimento del comando (code !== 0).
 */
export function execArgvInContainer(
  argv,
  { container = CONTAINER_NAME, timeoutMs = 30_000, detached = false, env = null } = {},
) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, stdout: '', stderr: 'argv vuoto', code: -1 };
  }
  const parts = argv.map((a) => String(a));

  if (isContainer()) {
    if (container !== CONTAINER_NAME) return unreachable(container);
    const childEnv = env ? { ...process.env, ...env } : process.env;
    if (detached) {
      // Equivalente in-container di `docker exec -d`: il parent non aspetta.
      const child = spawn(parts[0], parts.slice(1), {
        detached: true,
        stdio: 'ignore',
        env: childEnv,
      });
      child.unref();
      return { ok: true, stdout: '', stderr: '', code: 0 };
    }
    const r = spawnSync(parts[0], parts.slice(1), {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: childEnv,
    });
    return toResult(r);
  }

  if (!containerRunning(container)) return notRunning(container);

  const dockerArgv = ['exec', detached ? '-d' : '-i'];
  if (env) {
    for (const [k, v] of Object.entries(env)) dockerArgv.push('-e', `${k}=${v}`);
  }
  dockerArgv.push(container, ...parts);
  const r = spawnSync('docker', dockerArgv, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return toResult(r);
}

/**
 * Esegue una riga di shell dentro al container (`bash -c <cmd>`).
 *
 * Da usare SOLO quando serve davvero la shell: pipe, redirezioni, `||`.
 * Se il comando e' un programma con argomenti, `execArgvInContainer` o
 * `execScriptInContainer` sono la strada giusta — niente quoting.
 */
export function execInContainer(cmd, opts = {}) {
  return execArgvInContainer(['bash', '-c', cmd], opts);
}

/**
 * Esegue uno script dentro al container con argomenti separati (niente
 * parsing shell del chiamante).
 *
 * `interpreter` default 'bash'; le skill Python passano 'python3'.
 * Path di script DEVE essere quello container-side (es. /app/.launcher/...),
 * e' lo stesso filesystem in entrambe le modalita'.
 */
export function execScriptInContainer(scriptPath, args = [], { interpreter = 'bash', ...opts } = {}) {
  return execArgvInContainer([interpreter, scriptPath, ...args], opts);
}

/** Lista sessioni tmux attive nel container. */
export function listContainerSessions(container = CONTAINER_NAME) {
  const r = execInContainer('tmux list-sessions -F "#{session_name}" 2>/dev/null || true', { container });
  if (!r.ok) return [];
  return r.stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean);
}
