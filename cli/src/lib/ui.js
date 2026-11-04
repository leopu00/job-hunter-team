/**
 * The few pieces every screen of the command line is made of, so that they look and behave alike.
 *
 * Before this each command drew its own title, its own marks (● ◐ ○ ◆ ■ ▲ …), its own error prefix and its own
 * table with fixed widths. The proposal (banda/piani/PROPOSTA-estetica-cli-20261103.md, §3) fixes five elements:
 *
 *   title      one line, bold, and an optional detail in grey          title('Agents', '0 of 7 active')
 *   statusLine four marks only: ✓ ok (green), ! attention (yellow), ✗ error (red), · info (grey)
 *   table      columns that count what they print (marks and colours included) and fit the terminal
 *   hint       "→ next step", grey: every empty or failed state says what to do
 *   errorBlock what happened · why · what to do, on stderr, with one prefix
 *
 * Colour follows lib/../commands/_colors.js (NO_COLOR, FORCE_COLOR, a terminal on stdout); on a pipe nothing here
 * writes a control byte. The marks are plain characters: JHT_ASCII=1 turns them into ASCII for a terminal that
 * cannot draw them. The text of a screen is not here: it comes from the command (and, later, from the language).
 */
import { c } from '../commands/_colors.js';

const MARKS = { ok: '✓', warn: '!', fail: '✗', info: '·', arrow: '→', ellipsis: '…' };
const ASCII_MARKS = { ok: '+', warn: '!', fail: 'x', info: '-', arrow: '->', ellipsis: '...' };

export function marks() {
  return process.env.JHT_ASCII === '1' ? ASCII_MARKS : MARKS;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text) {
  return String(text).replace(ANSI, '');
}

/** Columns a string takes on screen: escapes count for nothing, every other character for one. */
export function visibleLength(text) {
  return [...stripAnsi(text)].length;
}

/** The width to draw for: the terminal's, else $COLUMNS, else 80; never under 40 or over 120. */
export function terminalWidth(stream = process.stdout) {
  const w = Number(stream?.columns) || Number(process.env.COLUMNS) || 80;
  return Math.max(40, Math.min(w, 120));
}

/** Cuts a string to `max` visible columns with an ellipsis; a string with colour in it is cut on its text. */
export function truncate(text, max) {
  const plain = stripAnsi(text);
  const chars = [...plain];
  if (chars.length <= max) return text;
  const { ellipsis } = marks();
  const keep = Math.max(0, max - [...ellipsis].length);
  return `${chars.slice(0, keep).join('')}${ellipsis}`;
}

export function padEnd(text, width) {
  return `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`;
}

export function title(text, detail) {
  return ['', `  ${c.bold(text)}${detail ? c.gray(` · ${detail}`) : ''}`, ''].join('\n');
}

/** Words to lines of at most `max` columns (a word longer than that stays whole). */
export function wrapText(text, max) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && visibleLength(line) + 1 + visibleLength(word) > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const KIND_COLOR = { ok: c.green, warn: c.yellow, fail: c.red, info: c.gray };

/** `  ✓ text`, with an optional grey hint on the line below: the mark and the colour say the state. */
export function statusLine(kind, text, { hint: next, indent = 2, width = terminalWidth() } = {}) {
  const mark = (KIND_COLOR[kind] ?? c.gray)(marks()[kind] ?? marks().info);
  const wrapped = wrapText(text, Math.max(20, width - indent - 2));
  const body = wrapped.map((part) => (kind === 'info' ? c.gray(part) : part));
  const lines = [`${' '.repeat(indent)}${mark} ${body[0]}`, ...body.slice(1).map((part) => `${' '.repeat(indent + 2)}${part}`)];
  if (next) lines.push(hint(next, indent + 2, width));
  return lines.join('\n');
}

export function hint(text, indent = 2, width = terminalWidth()) {
  const arrow = marks().arrow;
  const wrapped = wrapText(text, Math.max(20, width - indent - [...arrow].length - 1));
  return wrapped
    .map((part, i) => `${' '.repeat(indent)}${c.gray(i === 0 ? `${arrow} ${part}` : `${' '.repeat([...arrow].length + 1)}${part}`)}`)
    .join('\n');
}

/**
 * A table that fits. `columns` are `{ label, shrink?: true, min?: n, drop?: true }`; `rows` are arrays of strings (they may
 * carry colour and marks: the width counts what is seen). When the table is wider than `width`, the columns marked
 * `shrink` (the last one by default) lose width, down to `min` (default 8), and their text is cut with an ellipsis;
 * a column marked `drop` is left out, from the right, while the table is still wider than `width`.
 */
export function table(columns, rows, { width = terminalWidth(), indent = 2, gap = 2 } = {}) {
  // Columns marked `drop` go, from the right, while a shrinking column would stay under its `min` (when it has one).
  let keep = columns.map((_, i) => i);
  const layout = () => {
    const cols = keep.map((i) => columns[i]);
    const natural = keep.map((i, k) => Math.max(visibleLength(cols[k].label), ...rows.map((r) => visibleLength(r[i] ?? ''))));
    const widths = [...natural];
    const total = () => indent + widths.reduce((a, b) => a + b, 0) + gap * (cols.length - 1);
    const shrinkable = cols.map((col, k) => (col.shrink ? k : -1)).filter((k) => k >= 0);
    if (shrinkable.length === 0) shrinkable.push(cols.length - 1);
    for (const k of shrinkable) {
      const over = total() - width;
      if (over <= 0) break;
      widths[k] = Math.max(Math.min(natural[k], cols[k].min ?? 8), widths[k] - over);
    }
    return { cols, widths, natural, shrinkable, over: total() - width };
  };
  let state = layout();
  for (;;) {
    const squeezed = state.over > 0;
    const droppable = [...keep].reverse().find((i) => columns[i].drop);
    if (!squeezed || droppable === undefined) break;
    keep = keep.filter((i) => i !== droppable);
    state = layout();
  }
  const { cols, widths } = state;
  const line = (cells) =>
    `${' '.repeat(indent)}${cells.map((cell, k) => (k === cells.length - 1 ? truncate(cell ?? '', widths[k]) : padEnd(truncate(cell ?? '', widths[k]), widths[k]))).join(' '.repeat(gap))}`.trimEnd();
  const pick = (r) => keep.map((i) => r[i] ?? '');
  const rule = `${' '.repeat(indent)}${widths.map((w) => '─'.repeat(w)).join(' '.repeat(gap))}`;
  return [line(cols.map((col) => c.gray(col.label))), c.gray(rule), ...rows.map((r) => line(pick(r)))].join('\n');
}

/** What happened, why, and what to do: for stderr, one prefix for every command. */
export function errorBlock({ what, why, fix }) {
  const lines = [`${c.red(c.bold('Error:'))} ${what}`];
  if (why) lines.push(`  ${why}`);
  if (fix) lines.push(hint(fix));
  return lines.join('\n');
}

/** `label  value` lines with the values lined up: for the screens that say a few facts (status). */
export function keyValues(pairs, { indent = 2, gap = 2 } = {}) {
  const wide = Math.max(...pairs.map(([label]) => visibleLength(label)));
  return pairs
    .map(([label, value]) => `${' '.repeat(indent)}${padEnd(c.gray(label), wide)}${' '.repeat(gap)}${value}`.trimEnd())
    .join('\n');
}
