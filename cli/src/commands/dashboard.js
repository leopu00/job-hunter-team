/**
 * `jht dashboard` — DEPRECATO (2026-07-23).
 *
 * La dashboard web su localhost:3000 e' stata ritirata con la native
 * desktop migration: tutta l'interazione local/VPS vive nell'app desktop
 * (il gioco), che parla col container via docker exec / SSH — niente
 * browser su localhost. Il browser serve solo il cloud
 * (https://jobhunterteam.ai, con login), che e' una storia separata.
 *
 * Il comando resta registrato per non rompere script/abitudini: spiega
 * dove sono finite le cose ed esce con codice 0.
 */

import { DIM, YELLOW, BOLD, RESET } from './_colors.js';

function handleDashboard() {
  console.log(`\n  ${BOLD}JHT — Dashboard${RESET}\n`);
  console.log(`  ${YELLOW}The local web dashboard has been withdrawn.${RESET}`);
  console.log(`  ${DIM}Interaction local/VPS → desktop app Job Hunter Team (the game).${RESET}`);
  console.log(`  ${DIM}View from browser/phone → https://jobhunterteam.ai (requires login).${RESET}\n`);
}

export function registerDashboardCommand(program) {
  program
    .command('dashboard')
    .alias('web')
    .description('[deprecated] The local dashboard now lives in the desktop app')
    .action(handleDashboard);
}
