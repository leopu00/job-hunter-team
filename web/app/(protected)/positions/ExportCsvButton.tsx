"use client";

import { useState } from "react";
import { exportFileName, readTable, tableCsv } from "@/lib/table-csv";

type Labels = {
  button: string;
  title: string;
  /** «Saved in {path}» */
  saved: string;
  failed: string;
  empty: string;
};

/** The desktop listens to this event and saves the file natively (desktop/src/lib/export-csv.ts). */
const EXPORT_CSV_EVENT = "jht:export-csv";

function downloadInBrowser(name: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Saves the table on screen as a CSV: the columns the person chose, the rows of
 * this page of results, the text of each cell as shown. It reads the table, not
 * the data, so it cannot hand out anything the screen does not show.
 */
export default function ExportCsvButton({ labels }: { labels: Labels }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function run() {
    setMessage(null);
    const table = document.querySelector<HTMLTableElement>(
      "table[data-export='positions']",
    );
    const { headers, rows } = table
      ? readTable(table)
      : { headers: [], rows: [] };
    if (rows.length === 0) {
      setMessage({ ok: false, text: labels.empty });
      return;
    }
    const name = exportFileName("jht-posizioni", new Date());
    const csv = tableCsv(headers, rows);
    const detail: { name: string; csv: string; result?: Promise<string> } = {
      name,
      csv,
    };
    const handledByDesktop = !window.dispatchEvent(
      new CustomEvent(EXPORT_CSV_EVENT, { detail, cancelable: true }),
    );
    if (!handledByDesktop || !detail.result) {
      downloadInBrowser(name, csv);
      return;
    }
    try {
      const path = await detail.result;
      setMessage({ ok: true, text: labels.saved.replace("{path}", path) });
    } catch {
      setMessage({ ok: false, text: labels.failed });
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void run()}
        title={labels.title}
        className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors cursor-pointer"
      >
        {labels.button}
      </button>
      {message && (
        <span
          role={message.ok ? "status" : "alert"}
          className="text-[10px] max-w-[22rem] truncate"
          title={message.text}
          style={{
            color: message.ok
              ? "var(--color-muted)"
              : "var(--color-red, #e5484d)",
          }}
        >
          {message.text}
        </span>
      )}
    </span>
  );
}
