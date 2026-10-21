/**
 * A table's rows as CSV, exactly as the person sees them.
 *
 * The positions export reads the table on screen: its column headers, its rows,
 * the text of each cell. Nothing is asked of the data again, so nothing the
 * person does not already see can leave in the file (hidden columns, other
 * people's rows, ids the table does not show). Pure, so it is tested without a
 * browser.
 */

/** Excel and the Windows tools read UTF-8 as ANSI without this. */
export const CSV_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: a formula-looking text is made plain text, quotes are doubled. */
export function csvCell(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  // «—» is how the screen says "nothing": in a file it is an empty cell.
  const shown = text === "—" ? "" : text;
  const safe = FORMULA_START.test(shown) ? `'${shown}` : shown;
  return /[",\r\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function tableCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (cells: readonly string[]) => cells.map(csvCell).join(",");
  return CSV_BOM + [line(headers), ...rows.map(line)].join("\r\n") + "\r\n";
}

/** The visible table's headers and rows, from its elements. */
export function readTable(table: HTMLTableElement): {
  headers: string[];
  rows: string[][];
} {
  // What a cell shows, except the flags that ride beside it (`data-csv-skip`):
  // the title cell holds the title, not the «suspicious» badge next to it.
  const text = (cell: Element) => {
    const copy = cell.cloneNode(true) as Element;
    copy.querySelectorAll("[data-csv-skip]").forEach((flag) => flag.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  const headers = [...table.querySelectorAll("thead th")].map(text);
  const rows = [...table.querySelectorAll("tbody tr")]
    .map((row) =>
      [...row.children].filter((cell) => cell.tagName === "TD").map(text),
    )
    // the empty state is one wide cell with a sentence, not a row of data
    .filter((cells) => !(cells.length === 1 && headers.length > 1));
  return { headers, rows };
}

/** `jht-posizioni-2026-10-20.csv`: only characters a file name can always hold. */
export function exportFileName(prefix: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  const safe =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "export";
  return `${safe}-${day}.csv`;
}
