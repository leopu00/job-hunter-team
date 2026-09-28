/**
 * `npm run dev` (tauri dev's beforeDevCommand): Vite, started again when
 * someone else ends it.
 *
 * On a shared Mac other sessions clean up their own dev servers with
 * `pkill -f "node .*vite"`, and that pattern matches this Vite too. Vite
 * answers SIGTERM by closing without a word, with code 143; tauri dev then
 * says «The beforeDevCommand terminated with a non-zero status code» and the
 * app is left without its pages (27/09, twice).
 *
 * This process runs Vite as a child with the same arguments and output. When
 * the child ends from outside (a signal, or 128+signal), it starts it again
 * on the same port, and the Vite client in the window reloads the page when
 * the server answers again. Any other end is Vite's own (a config error, the
 * port taken, stdin closed) and ends this process with the same code. When
 * this process is asked to stop (tauri dev closing, Ctrl-C), it stops Vite
 * and does not start it again. Its own command line does not say "vite",
 * so the same pkill passes it by.
 */
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

/** How a child ended, as a shell reports it: the code, or 128 + the signal's number. */
export function exitCodeOf(code, signal) {
  if (code !== null && code !== undefined) return code;
  return 128 + (constants.signals[signal] ?? 0);
}

/**
 * Ended from outside: killed by SIGTERM, SIGKILL or SIGHUP, or closed by its
 * own handler of one of them (Vite exits 143 on SIGTERM). SIGINT is Ctrl-C in
 * the terminal, which is meant for this process too.
 */
export function endedFromOutside(code, signal) {
  if (signal) return signal !== "SIGINT";
  return code === 128 + constants.signals.SIGTERM || code === 128 + constants.signals.SIGKILL || code === 128 + constants.signals.SIGHUP;
}

/**
 * The supervisor, without the process around it (tested with a fake child).
 * `start()` returns a child with once("exit", (code, signal)) and kill(signal);
 * `exit(code)` ends the supervisor. At most `maxRestarts` in `windowMs`: past
 * that, whatever is ending Vite is not a one-off, and it is said.
 */
export function superviseDevServer({ start, exit, log, maxRestarts = 5, windowMs = 60_000, delayMs = 500, now = Date.now, setTimer = setTimeout }) {
  let child = null;
  let stopping = false;
  const restarts = [];

  const run = () => {
    if (stopping) return; // stop() has already ended it
    child = start();
    child.once("exit", (code, signal) => {
      child = null;
      const status = exitCodeOf(code, signal);
      if (stopping || !endedFromOutside(code, signal)) return exit(status);
      const t = now();
      while (restarts.length > 0 && restarts[0] <= t - windowMs) restarts.shift();
      if (restarts.length >= maxRestarts) {
        log(`[dev] Vite was ended from outside ${restarts.length + 1} times in ${Math.round(windowMs / 1000)} s: not starting it again.`);
        return exit(status);
      }
      restarts.push(t);
      log(`[dev] Vite was ended from outside (${signal ?? `code ${code}`}): starting it again.`);
      setTimer(run, delayMs);
    });
  };

  run();
  return {
    /** asked to stop: stop Vite, and do not start it again */
    stop(signal) {
      stopping = true;
      if (child) child.kill(signal);
      else exit(0);
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  const supervisor = superviseDevServer({
    start: () => spawn(process.execPath, [vite, ...process.argv.slice(2)], { stdio: "inherit" }),
    exit: (code) => process.exit(code),
    log: (message) => console.error(message),
  });
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => supervisor.stop(signal));
}
