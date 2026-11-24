// The secrets broker's link to the website, seen from the box.
//
// The broker polls the site for web authorisations with the device token, and it cannot read cloud.json (its home is
// an empty tmpfs), so it keeps its own word for «the sync is on»: off until the host says on (jht-broker-admin apply
// web-sync, run by the host wrapper at every start and after jht cloud pause|resume|enable|login|disable).
// From inside the box the only thing that can be done is to PAUSE it (op `web.pause` on the agents' socket): the socket
// narrows and never widens, so a resume inside the container cannot reach the broker, and says so.
import { existsSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

export const BROKER_SOCKET_DIR_ENV = 'JHT_BROKER_SOCKET_DIR';
const DEFAULT_SOCKET_DIR = '/run/jht-broker';
const SOCKET_NAME = 'broker.sock';

export function brokerSocketPath(env = process.env) {
  return join(env?.[BROKER_SOCKET_DIR_ENV] || DEFAULT_SOCKET_DIR, SOCKET_NAME);
}

/** True when this box has a broker socket (the broker was made and its volume is mounted here). */
export function brokerPresent({ env = process.env, exists = existsSync } = {}) {
  return exists(brokerSocketPath(env));
}

/**
 * Tell the broker to stop asking the website. Never throws.
 * @returns {Promise<{state: 'no-broker'|'paused'|'unreachable', reason?: string}>}
 *   no-broker: there is no socket, nothing to stop (the host aligns the broker if it is made later).
 */
export function pauseBrokerWebSync({ env = process.env, timeoutMs = 3000, exists = existsSync, connect = net.createConnection } = {}) {
  const path = brokerSocketPath(env);
  if (!exists(path)) return Promise.resolve({ state: 'no-broker' });
  return new Promise((resolve) => {
    let socket;
    let timer;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch { /* already closed */ }
      resolve(result);
    };
    timer = setTimeout(() => finish({ state: 'unreachable', reason: 'timeout' }), timeoutMs);
    try {
      socket = connect(path);
    } catch (err) {
      finish({ state: 'unreachable', reason: err?.code || 'connect' });
      return;
    }
    let data = '';
    socket.setEncoding?.('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ op: 'web.pause', args: {}, role: 'cli' })}\n`));
    socket.on('data', (chunk) => {
      data += chunk;
      if (!data.includes('\n')) return;
      let answer = null;
      try { answer = JSON.parse(data.split('\n', 1)[0]); } catch { /* bad answer */ }
      if (answer?.ok === true && answer.sync === 'off') finish({ state: 'paused' });
      else finish({ state: 'unreachable', reason: typeof answer?.reason === 'string' ? answer.reason : 'bad-answer' });
    });
    socket.on('error', (err) => finish({ state: 'unreachable', reason: err?.code || 'error' }));
    socket.on('close', () => finish({ state: 'unreachable', reason: 'closed' }));
  });
}

/** The line for a pause that did not reach a broker that is there, or null. */
export function brokerPauseNote(result) {
  if (result?.state !== 'unreachable') return null;
  return 'The secrets broker could not be told now (' + result.reason + '); it stops asking the site at the next jht up.';
}

/** The line after a resume, when there is a broker: from inside the box it cannot be turned on, only from the host. */
export const BROKER_RESUME_NOTE =
  'The secrets broker takes the change from the host: jht cloud resume run from your terminal does it now, otherwise the next jht up.';
