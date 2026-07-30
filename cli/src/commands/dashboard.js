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
  console.log(`  ${YELLOW}La dashboard web locale e' stata ritirata.${RESET}`);
  console.log(`  ${DIM}Interazione local/VPS → app desktop Job Hunter Team (il gioco).${RESET}`);
  console.log(`  ${DIM}Vista da browser/telefono → https://jobhunterteam.ai (richiede login).${RESET}\n`);
}

export function registerDashboardCommand(program) {
  program
    .command('dashboard')
    .alias('web')
    .description('[deprecato] La dashboard locale ora vive nella app desktop')
    .action(handleDashboard);
}
