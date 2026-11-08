import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { say } from '../lib/texts.js';
import { openObservationStream, readObservation, validObservation } from '../lib/agent-observation.js';
import { errorText, renderObservation } from '../lib/agent-observation-view.js';
import { appendDiagnostic } from '../lib/runtime-diagnostic.js';

// Request pacing bounds work to one sample outstanding. Closing the view
// never signals the team's processes. No terminal keys or pane capture.
export async function monitor(options, {
  output = process.stdout, signals = process, open = openObservationStream,
  read = readObservation, intervalMs = 3000, shutdownMs = 4000,
} = {}) {
  if (options.window) throw new Error('observer_window_host_required');
  if (options.once || options.json) {
    const snapshot = read();
    output.write(options.json ? `${JSON.stringify(snapshot)}\n` : renderObservation(snapshot, { live: true }));
    return snapshot.ok ? 0 : 1;
  }
  if (!output.isTTY) throw new Error('observer_terminal_required');
  const child = open();
  const lines = createInterface({ input: child.stdout });
  let ended = false, timer, deadline, shutdown, failure;
  const closed = once(child, 'close').catch(() => {});
  const stop = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer); clearTimeout(deadline);
    child.stdin.end();
    shutdown = setTimeout(() => child.kill('SIGTERM'), shutdownMs);
  };
  const fail = (code) => { failure = code; stop(); };
  const request = () => {
    if (ended) return;
    child.stdin.write('\n');
    deadline = setTimeout(() => { fail('observer_read_failed'); child.kill('SIGTERM'); }, 20_000);
  };
  const interrupted = () => stop();
  signals.on('SIGINT', interrupted); signals.on('SIGTERM', interrupted);
  lines.on('line', (line) => {
    clearTimeout(deadline);
    if (ended) return;
    try {
      const snapshot = JSON.parse(line);
      if (!validObservation(snapshot)) throw new Error('invalid');
      output.write(`\x1b[H\x1b[2J${renderObservation(snapshot, { live: true })}`);
    } catch { fail('observer_read_invalid'); return; }
    timer = setTimeout(request, intervalMs);
  });
  child.on('error', () => fail('observer_read_failed'));
  child.stdin.on('error', () => { if (!ended) fail('observer_read_failed'); });
  child.stderr.resume();
  try {
    request();
    await closed;
    if (!ended) failure = 'observer_read_failed';
  } finally {
    stop(); clearTimeout(shutdown); lines.close();
    signals.off('SIGINT', interrupted); signals.off('SIGTERM', interrupted);
  }
  if (failure) throw new Error(failure);
  return 0;
}

export function registerMonitorCommand(program) {
  program.command('monitor').description(say('observation.monitor_description'))
    .option('--window', say('observation.window_option'))
    .option('--once', say('observation.once_option'))
    .option('--json', say('option.json'))
    .action(async (options) => {
      try { process.exitCode = await monitor(options); }
      catch (error) {
        const code = ['observer_terminal_required', 'observer_read_invalid', 'observer_window_host_required'].includes(error.message)
          ? error.message : 'observer_read_failed';
        console.error(`${code}: ${errorText(code)}\n${say('observation.fix')}`);
        try { appendDiagnostic(code); }
        catch { console.error(errorText('observer_log_unavailable')); }
        process.exitCode = 1;
      }
    });
}
