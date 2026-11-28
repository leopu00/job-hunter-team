import { installTerminalSymbols } from './terminal-symbols.js';

// Clack chooses its symbols once, at import time. Its Unicode override signal is TERM.
// Set it before importing clack when the person explicitly requests Unicode.
if (process.env.JHT_UNICODE === '1') process.env.TERM = 'xterm-256color';
installTerminalSymbols();
