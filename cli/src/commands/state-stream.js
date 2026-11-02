// `jht state-stream` — the long exec the desktop app keeps open to read the team's state (see lib/state-stream.js).
//
// stdin: requests, one JSON object per line. stdout: the hello, then the answers and the hints. Not a command a
// person types; it has no options, and it ends when stdin ends.

import { Command } from 'commander';
import { createStateStream } from '../lib/state-stream.js';

export function registerStateStreamCommand(program) {
  program.addCommand(
    new Command('state-stream')
      .description("The desktop app's channel to the team's state (NDJSON on stdin and stdout; not for typing)")
      .helpOption(false)
      .action(() => {
        process.stdin.setEncoding('utf8');
        let finished = false;
        const stream = createStateStream({
          write: (line) => {
            process.stdout.write(`${line}\n`);
          },
          end: (code) => {
            if (finished) return;
            finished = true;
            process.exitCode = code;
            process.stdin.destroy();
            // the last lines are written before the process goes; the hard stop is for a stuck pipe
            process.stdout.write('', () => process.exit(code));
            setTimeout(() => process.exit(code), 500).unref();
          },
        });
        process.stdout.on('error', () => stream.close());
        process.stdin.on('data', (chunk) => stream.push(chunk));
        process.stdin.on('end', () => stream.close());
        process.stdin.on('error', () => stream.close());
        stream.hello();
      }),
  );
}
