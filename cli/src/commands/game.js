function hostOnly(command) {
  console.error(`\n  Errore: ${command} controlla l'app nativa e deve essere eseguito dal comando jht dell'host.\n`);
  process.exitCode = 1;
}


export function registerGameCommand(program) {
  const game = program
    .command('game')
    .description('Avvia, ferma e mostra lo stato del client desktop');

  game.command('start').description('Avvia il client in modo idempotente').action(() => hostOnly('game start'));
  game.command('stop').description('Chiude il client lasciando il team in background').action(() => hostOnly('game stop'));
  game.command('status').description('Mostra lo stato del client desktop').action(() => hostOnly('game status'));
  game.command('restart').description('Riavvia il client in modo cooperativo').action(() => hostOnly('game restart'));
  game.command('background').description('Minimizza il client lasciandolo in esecuzione').action(() => hostOnly('game background'));

  const gui = program.command('gui').description("Controlla l'interfaccia grafica nativa");
  gui.command('open').description("Avvia o porta in primo piano l'interfaccia").action(() => hostOnly('gui open'));
}
