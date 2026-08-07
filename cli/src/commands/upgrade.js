import { GREEN, YELLOW, DIM, RESET } from './_colors.js';

/**
 * The product runtime is an immutable Docker image. The host-side `jht`
 * wrapper owns its update transaction because only it can pull, recreate and
 * roll back the container. This command still exists inside the image so a
 * direct `docker exec ... jht upgrade` fails clearly instead of attempting an
 * unsafe and ineffective git/npm mutation under /app.
 */
function handleUpgrade(options) {
  const result = {
    ok: false,
    changed: false,
    phase: 'host_required',
    previous: { version: '', image: '' },
    current: { version: '', image: '' },
    restartRequired: false,
    message: 'Run jht upgrade on the host to update the runtime.',
    rolledBack: false,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    console.log(`\n  ${YELLOW}Host runtime update required.${RESET}`);
    console.log(`  ${DIM}Run this on the computer or VPS that hosts Docker:${RESET} ${GREEN}jht upgrade${RESET}`);
    console.log(`  ${DIM}The host command downloads, checks and activates the new image;${RESET}`);
    console.log(`  ${DIM}If verification fails, the latest working version is restored.${RESET}\n`);
  }
  process.exitCode = 2;
}

export function registerUpgradeCommand(program) {
  program
    .command('upgrade')
    .description('Update runtime from the Docker host wrapper')
    .option('-c, --check', 'accepted by the host wrapper; no changes are made here')
    .option('-a, --apply', 'accepted by the host wrapper; no changes are made here')
    .option('--json', 'emit the JSON contract for a GUI caller')
    .action(handleUpgrade);
}
