import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExportCsvButton from "../../../../web/app/(protected)/positions/ExportCsvButton";
import { CSV_BOM, csvCell, exportFileName, readTable, tableCsv } from "@/lib/table-csv";

const labels = {
  button: "Esporta CSV",
  title: "Salva in un file CSV",
  saved: "Salvato in {path}",
  failed: "Non sono riuscito a salvare il file.",
  empty: "Non c’è niente da esportare.",
};

function Table({ rows = 2 }: { rows?: number }) {
  return (
    <table data-export="positions" aria-label="Elenco">
      <thead>
        <tr>
          <th>ID</th>
          <th>Titolo</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        {rows === 0 ? (
          <tr>
            <td colSpan={3}>Nessuna posizione</td>
          </tr>
        ) : (
          Array.from({ length: rows }, (_unused, i) => (
            <tr key={i}>
              <td>JHT-00{i + 1}</td>
              <td>{i === 0 ? 'Engineer, "Senior"' : "=HYPERLINK(\"x\")"}</td>
              <td>{i === 0 ? "—" : "74"}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

describe("table → CSV", () => {
  it("quotes what needs quotes, doubles the quotes and turns a formula into text", () => {
    expect(csvCell('Engineer, "Senior"')).toBe('"Engineer, ""Senior"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+39 02 1234")).toBe("'+39 02 1234");
    expect(csvCell("  plain   text ")).toBe("plain text");
  });

  it("writes the screen's «nothing» dash as an empty cell", () => {
    expect(csvCell("—")).toBe("");
  });

  it("starts with a BOM and ends every line with CRLF, header first", () => {
    const csv = tableCsv(["a", "b"], [["1", "2"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(CSV_BOM.length)).toBe("a,b\r\n1,2\r\n");
  });

  it("reads the headers and the rows of the table on screen, and not its empty-state sentence", () => {
    const { container } = render(<Table />);
    const read = readTable(container.querySelector("table")!);
    expect(read.headers).toEqual(["ID", "Titolo", "Score"]);
    expect(read.rows).toEqual([
      ["JHT-001", 'Engineer, "Senior"', "—"],
      ["JHT-002", '=HYPERLINK("x")', "74"],
    ]);
    cleanup();
    const empty = render(<Table rows={0} />);
    expect(readTable(empty.container.querySelector("table")!).rows).toEqual([]);
  });

  it("names the file with the day and nothing a file name cannot hold", () => {
    expect(exportFileName("JHT Posizioni!", new Date("2026-10-20T10:00:00Z"))).toBe("jht-posizioni-2026-10-20.csv");
    expect(exportFileName("///", new Date("2026-10-20T10:00:00Z"))).toBe("export-2026-10-20.csv");
  });
});

describe("the Export CSV button", () => {
  const click = vi.fn();
  beforeEach(() => {
    click.mockReset();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:synthetic"), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads the file in a browser, where nobody takes the event", async () => {
    render(
      <>
        <ExportCsvButton labels={labels} />
        <Table />
      </>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Esporta CSV" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("hands the file to the desktop, which saves it, and says where it went", async () => {
    const seen: { name: string; csv: string }[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ name: string; csv: string; result?: Promise<string> }>).detail;
      seen.push({ name: detail.name, csv: detail.csv });
      event.preventDefault();
      detail.result = Promise.resolve("/Users/ada/Downloads/jht-posizioni.csv");
    };
    window.addEventListener("jht:export-csv", listener);
    try {
      render(
        <>
          <ExportCsvButton labels={labels} />
          <Table />
        </>,
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Esporta CSV" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Salvato in /Users/ada/Downloads/jht-posizioni.csv");
      expect(click).not.toHaveBeenCalled();
      expect(seen).toHaveLength(1);
      expect(seen[0].name).toMatch(/^jht-posizioni-\d{4}-\d{2}-\d{2}\.csv$/);
      // only what the table shows: its three columns, its two rows
      expect(seen[0].csv.replace(CSV_BOM, "").split("\r\n").filter(Boolean)).toHaveLength(3);
      expect(seen[0].csv).toContain("ID,Titolo,Score");
    } finally {
      window.removeEventListener("jht:export-csv", listener);
    }
  });

  it("says what went wrong when the desktop could not save", async () => {
    const listener = (event: Event) => {
      event.preventDefault();
      (event as CustomEvent).detail.result = Promise.reject(new Error("export_write_failed"));
    };
    window.addEventListener("jht:export-csv", listener);
    try {
      render(
        <>
          <ExportCsvButton labels={labels} />
          <Table />
        </>,
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Esporta CSV" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Non sono riuscito a salvare il file."));
    } finally {
      window.removeEventListener("jht:export-csv", listener);
    }
  });

  it("says there is nothing to export when the page has no rows, and saves nothing", async () => {
    render(
      <>
        <ExportCsvButton labels={labels} />
        <Table rows={0} />
      </>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Esporta CSV" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Non c’è niente da esportare.");
    expect(click).not.toHaveBeenCalled();
  });
});
