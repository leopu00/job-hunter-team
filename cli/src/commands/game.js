function hostOnly(command) {
  console.error(`\n  Error: ${command} controls the native app and must be run from the host jht command.\n`);
  process.exitCode = 1;
}


export function registerGameCommand(program) {
  const game = program
    .command('game')
    .description('Start, stop, and show the desktop client status');

  game.command('start').description('Start the client idempotently').action(() => hostOnly('game start'));
  game.command('stop').description('Close the client while leaving the team running in the background').action(() => hostOnly('game stop'));
  game.command('status').description('Show the desktop client status').action(() => hostOnly('game status'));
  game.command('restart').description('Restart the client cooperatively').action(() => hostOnly('game restart'));
  game.command('background').description('Minimize the client while leaving it running').action(() => hostOnly('game background'));

  const gui = program.command('gui').description('Control the native graphical interface');
  gui.command('open').description('Start the interface or bring it to the foreground').action(() => hostOnly('gui open'));
}
