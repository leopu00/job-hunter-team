/**
 * The text of a note of the setup, wrapped to the width of the terminal.
 *
 * clack draws a note as a box as wide as its longest line plus 6 columns («│  » before, two spaces and «│» after). A line wider
 * than the terminal went to the next row inside the box and broke its frame (collaudo Linux 23/11: the boxes «Account web» and
 * «Chiave API»). Each line is wrapped at the spaces so that the box fits; its indentation is kept on the rows it wraps to. A single
 * word longer than the room (a link, a path) is left whole: cut in two it could not be copied.
 */
const FRAME = 6;
const ANSI = /\x1b\[[0-9;]*m/g;

export function visibleLength(text) {
  return [...String(text).replace(ANSI, '')].length;
}

export function wrapNote(message, columns = process.stdout.columns) {
  const width = Math.max(20, (Number.isInteger(columns) && columns > 0 ? columns : 80) - FRAME);
  return String(message ?? '').split('\n').map((line) => {
    if (visibleLength(line) <= width) return line;
    const indent = line.match(/^\s*/)[0];
    const rows = [];
    let row = '';
    for (const word of line.slice(indent.length).split(/ +/)) {
      const next = row ? `${row} ${word}` : `${indent}${word}`;
      if (row && visibleLength(next) > width) {
        rows.push(row);
        row = `${indent}${word}`;
      } else {
        row = next;
      }
    }
    if (row) rows.push(row);
    return rows.join('\n');
  }).join('\n');
}
