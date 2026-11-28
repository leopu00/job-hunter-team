/** Conservative font capability heuristic: a console cannot report its supported glyphs.
 * JHT_UNICODE=0 selects ASCII, JHT_UNICODE=1 keeps Unicode even with an unknown font.
 */
export function usesUnicode(env = process.env, platform = process.platform) {
  if (env.JHT_UNICODE === '0') return false;
  if (env.JHT_UNICODE === '1') return true;
  if (platform !== 'win32') return env.TERM !== 'linux' && env.TERM !== 'dumb';
  return Boolean(env.WT_SESSION || env.TERM_PROGRAM === 'vscode' ||
    env.TERM_PROGRAM === 'WezTerm' || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm');
}

const SYMBOLS = {
  '◆': '>', '◇': '-', '■': 'x', '▲': '!', '●': '>', '○': ' ',
  '□': '[ ]', '◻': '[ ]', '◼': '[x]', '▪': '*', '•': '*',
  '✓': '[x]', '✔': '[x]', '✗': '[!]', '✘': '[!]', '✏': '',
  '♾': '', '∞': 'unlimited', '→': '->', '←': '<-', '…': '...', '—': '-', '–': '-',
  '◐': '*', '◑': '*', '◒': '*', '◓': '*',
  '─': '-', '━': '-', '│': '|', '┃': '|', '┌': '+', '┐': '+',
  '└': '+', '┘': '+', '├': '+', '┤': '+', '┬': '+', '┴': '+',
  '┼': '+', '╭': '+', '╮': '+', '╰': '+', '╯': '+',
};

/** Preserve translated letters and ANSI controls; replace decoration only. */
export function asciiSymbols(value) {
  return String(value).replace(/[◆◇■▲●○□◻◼▪•✓✔✗✘✏♾∞→←…—–◐◑◒◓─━│┃┌┐└┘├┤┬┴┼╭╮╰╯]/gu,
    (symbol) => SYMBOLS[symbol])
    .replace(/[\u2800-\u28ff]/gu, '*')
    .replace(/\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*/gu, '')
    .replace(/[\ufe0e\ufe0f\u200d]|\p{Emoji_Modifier}/gu, '');
}

const installed = new WeakSet();

/** Only terminal presentation is changed. Pipes, files, buffers and JSON stay intact.
 * Install before clack renders so frames, spinner, cancellation and custom text agree.
 */
export function installTerminalSymbols({ env = process.env, platform = process.platform,
  streams = [process.stdout, process.stderr], argv = process.argv } = {}) {
  if (usesUnicode(env, platform) || argv.some((arg) => /^--json(?:=|$)/.test(arg))) return;
  for (const stream of streams) {
    if (!stream.isTTY || installed.has(stream)) continue;
    const write = stream.write;
    stream.write = function (chunk, ...args) {
      return write.call(this, typeof chunk === 'string' ? asciiSymbols(chunk) : chunk, ...args);
    };
    installed.add(stream);
  }
}
