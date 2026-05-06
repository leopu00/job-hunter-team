// cli/src/utils/container-proxy.js
// Proxy helper verso il container `jht`.
//
// Due modalita' di funzionamento:
//
// 1. CLI gira sull'HOST (path "from source" o `--no-docker`):
//    le funzioni proxano via `docker exec jht ...` verso il container
//    long-running.
//
// 2. CLI gira DENTRO al container (path Docker via wrapper bash, IS_CONTAINER=1):
//    le funzioni eseguono i comandi localmente senza docker exec —
//    siamo gia' nel posto giusto.
//
// La modalita' e' decisa da `process.env.IS_CONTAINER`. Stessa API per
// i chiamanti — niente `docker exec` quando il CLI e' gia' nel container.
//
// ESM: il package cli/ ha "type": "module".
//
// Su Windows con git-bash, MSYS_NO_PATHCONV=1 serve quando il comando
// contiene path POSIX (es. `/app/.launcher/start-agent.sh`) per evitare
// la conversione automatica di /foo in C:\Program Files\Git\foo.

import { spawnSync } from 'node:child_process';

export const CONTAINER_NAME = process.env.JHT_CONTAINER_NAME || 'jht';

const INSIDE_CONTAINER = process.env.IS_CONTAINER === '1';

export function dockerAvailable() {
  if (INSIDE_CONTAINER) return true;
  const r = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

export function containerRunning(name = CONTAINER_NAME) {
  if (INSIDE_CONTAINER) return name === CONTAINER_NAME;
  if (!dockerAvailable()) return false;
  const r = spawnSync('docker', ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  return r.status === 0 && r.stdout.trim() === name;
}

/**
 * Esegue il comando dentro al container target.
 * - Sull'host: `docker exec <container> bash -c <cmd>`
 * - In-container: `bash -c <cmd>` direttamente (no docker exec).
 *
 * Ritorna { ok, stdout, stderr, code }. Il codice d'uscita del processo
 * interno e' preservato — il chiamante puo' distinguere fallimento del
 * trasporto (ok=false) da fallimento del comando (code !== 0).
 */
export function execInContainer(cmd, { container = CONTAINER_NAME, timeoutMs = 30_000 } = {}) {
  if (INSIDE_CONTAINER) {
    if (container !== CONTAINER_NAME) {
      return { ok: false, stdout: '', stderr: `container '${container}' non raggiungibile dall'interno di '${CONTAINER_NAME}'`, code: -1 };
    }
    const r = spawnSync('bash', ['-c', cmd], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    return {
      ok: r.status !== null,
      stdout: (r.stdout || '').toString(),
      stderr: (r.stderr || '').toString(),
      code: r.status ?? -1,
    };
  }

  if (!containerRunning(container)) {
    return { ok: false, stdout: '', stderr: `container '${container}' non attivo`, code: -1 };
  }
  const r = spawnSync('docker', ['exec', '-i', container, 'bash', '-c', cmd], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return {
    ok: r.status !== null,
    stdout: (r.stdout || '').toString(),
    stderr: (r.stderr || '').toString(),
    code: r.status ?? -1,
  };
}

/**
 * Esegue uno script dentro al container target con argomenti separati
 * (niente parsing shell del chiamante).
 * - Sull'host: `docker exec <container> bash <script> <args...>`.
 * - In-container: `bash <script> <args...>` direttamente.
 * - `detached: true` mappa a `docker exec -d` sull'host; in-container
 *   fa lo spawn detached con stdio='ignore' (parent non aspetta).
 *
 * Path di script DEVE essere quello container-side (es. /app/.launcher/...),
 * e' lo stesso filesystem in entrambe le modalita'.
 */
export function execScriptInContainer(scriptPath, args = [], { container = CONTAINER_NAME, detached = false } = {}) {
  if (INSIDE_CONTAINER) {
    if (container !== CONTAINER_NAME) {
      return { ok: false, stdout: '', stderr: `container '${container}' non raggiungibile dall'interno di '${CONTAINER_NAME}'`, code: -1 };
    }
    if (detached) {
      const child = spawnSync('bash', ['-c', `nohup bash "${scriptPath}" ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')} >/dev/null 2>&1 &`], {
        encoding: 'utf8',
      });
      return { ok: child.status !== null, stdout: '', stderr: '', code: child.status ?? 0 };
    }
    const r = spawnSync('bash', [scriptPath, ...args], { encoding: 'utf8' });
    return {
      ok: r.status !== null,
      stdout: (r.stdout || '').toString(),
      stderr: (r.stderr || '').toString(),
      code: r.status ?? -1,
    };
  }

  if (!containerRunning(container)) {
    return { ok: false, stdout: '', stderr: `container '${container}' non attivo`, code: -1 };
  }
  const argv = ['exec'];
  if (detached) argv.push('-d');
  else argv.push('-i');
  argv.push(container, 'bash', scriptPath, ...args);
  const r = spawnSync('docker', argv, {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  return {
    ok: r.status !== null,
    stdout: (r.stdout || '').toString(),
    stderr: (r.stderr || '').toString(),
    code: r.status ?? -1,
  };
}

/** Lista sessioni tmux attive nel container. */
export function listContainerSessions(container = CONTAINER_NAME) {
  const r = execInContainer('tmux list-sessions -F "#{session_name}" 2>/dev/null || true', { container });
  if (!r.ok) return [];
  return r.stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean);
}
