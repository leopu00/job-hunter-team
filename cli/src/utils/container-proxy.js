// cli/src/utils/container-proxy.js
// Proxy helper verso il container `jht`. Il team reale gira dentro il
// container Docker, non sull'host; il CLI `jht` sull'host deve poter
// interrogare e comandare quell'ambiente via `docker exec`.
//
// ESM: il package cli/ ha "type": "module".
//
// Su Windows con git-bash, MSYS_NO_PATHCONV=1 serve quando il comando
// contiene path POSIX (es. `/app/.launcher/start-agent.sh`) per evitare
// la conversione automatica di /foo in C:\Program Files\Git\foo.

import { spawnSync } from 'node:child_process';

export const CONTAINER_NAME = process.env.JHT_CONTAINER_NAME || 'jht';

export function dockerAvailable() {
  const r = spawnSync('docker', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

export function containerRunning(name = CONTAINER_NAME) {
  if (!dockerAvailable()) return false;
  const r = spawnSync('docker', ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });
  return r.status === 0 && r.stdout.trim() === name;
}

/**
 * Esegue `docker exec <container> bash -c <cmd>` e ritorna
 * { ok, stdout, stderr, code }. Mantiene il codice d'uscita del
 * processo interno, cosi' il chiamante puo' distinguere fallimento
 * docker (ok=false) da fallimento comando (code !== 0).
 */
export function execInContainer(cmd, { container = CONTAINER_NAME, timeoutMs = 30_000 } = {}) {
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
 * `docker exec <container> bash <script> <args...>` per invocare uno
 * script con argomenti separati (niente parsing shell del chiamante).
 * Path di script deve essere quello CONTAINER-side (es. /app/.launcher/...).
 */
export function execScriptInContainer(scriptPath, args = [], { container = CONTAINER_NAME, detached = false } = {}) {
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
