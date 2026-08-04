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
    message: 'L aggiornamento del runtime deve essere eseguito dall host con jht upgrade.',
    rolledBack: false,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    console.log(`\n  ${YELLOW}Aggiornamento runtime host richiesto.${RESET}`);
    console.log(`  ${DIM}Esegui sul computer/VPS che ospita Docker:${RESET} ${GREEN}jht upgrade${RESET}`);
    console.log(`  ${DIM}Il comando host scarica, verifica e rende attiva la nuova immagine;${RESET}`);
    console.log(`  ${DIM}se il controllo fallisce ripristina l ultima versione funzionante.${RESET}\n`);
  }
  process.exitCode = 2;
}

export function registerUpgradeCommand(program) {
  program
    .command('upgrade')
    .description('Aggiorna il runtime dal wrapper host Docker')
    .option('-c, --check', 'compatibile con il wrapper host; qui non modifica nulla')
    .option('-a, --apply', 'compatibile con il wrapper host; qui non modifica nulla')
    .option('--json', 'emette il contratto JSON per un chiamante GUI')
    .action(handleUpgrade);
}
