/** Test UI batch 10 — Table, TimelineCard (Carousel non esiste) */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) {
  const raw = fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

/* ── Table ── */
describe("Table", () => {
  const src = readSrc("app/components/Table.tsx");

  it("export Table (generic) + interface TableColumn + TableProps + SortDir", () => {
    expect(src).toMatch(/export function Table\b/);
    expect(src).toContain("export interface TableColumn");
    expect(src).toContain("export interface TableProps");
    expect(src).toContain("type SortDir");
  });

  it("TableColumn: key, label, sortable, width, render function, align left/center/right", () => {
    expect(src).toContain("key: keyof T | string");
    expect(src).toContain("label: string");
    expect(src).toContain("sortable?: boolean");
    expect(src).toContain("render?: (value: unknown, row: T, index: number)");
    expect(src).toContain("align?: 'left' | 'center' | 'right'");
  });

  it("sortData: localeCompare con numeric + asc/desc + copia array", () => {
    expect(src).toContain("function sortData");
    expect(src).toContain("[...data].sort"); expect(src).toContain("localeCompare");
    expect(src).toContain("numeric: true");
    expect(src).toContain("dir === 'asc' ? cmp : -cmp");
  });

  it("toggleSort: ciclo asc → desc → null + SortIcon SVG green per direzione attiva", () => {
    expect(src).toContain("const toggleSort");
    expect(src).toContain("setSortDir('asc')"); expect(src).toContain("setSortDir('desc')");
    expect(src).toContain("setSortDir(null)");
    expect(src).toContain("function SortIcon");
    expect(src).toContain("dir === 'asc' ? 'var(--color-green)' : 'var(--color-border)'");
    expect(src).toContain("dir === 'desc' ? 'var(--color-green)' : 'var(--color-border)'");
  });

  it("striped: righe alternate + hoverable: mouseEnter/Leave", () => {
    expect(src).toContain("striped"); expect(src).toContain("ri % 2 === 1");
    expect(src).toContain("hoverable"); expect(src).toContain("onMouseEnter");
    expect(src).toContain("onMouseLeave"); expect(src).toContain("var(--color-row)");
  });

  it("compact mode + emptyMessage 'Nessun dato' + loading 'Caricamento…' animate-pulse", () => {
    expect(src).toContain("compact"); expect(src).toContain("px-3 py-1.5"); expect(src).toContain("px-4 py-3");
    expect(src).toContain("'Nessun dato'"); expect(src).toContain("colSpan={columns.length}");
    expect(src).toContain("Caricamento…"); expect(src).toContain("animate-pulse");
  });

  it("onRowClick: cursor-pointer + render fallback '—' + thead tracking-widest uppercase", () => {
    expect(src).toContain("onRowClick ? () => onRowClick(row, ri)");
    expect(src).toContain("onRowClick ? 'cursor-pointer'");
    expect(src).toContain("?? '—'"); // fallback for null values
    expect(src).toContain("tracking-widest uppercase");
  });
});

/* ── TimelineCard ── */
describe("TimelineCard", () => {
  const src = readSrc("app/components/TimelineCard.tsx");

  it("export TimelineEventType + TimelineEvent + Timeline + TimelineCard", () => {
    expect(src).toContain("export type TimelineEventType");
    expect(src).toContain("export type TimelineEvent");
    expect(src).toMatch(/export function Timeline\b/);
    expect(src).toMatch(/export function TimelineCard\b/);
  });

  it("TimelineEventType 8: application_sent, interview_scheduled, offer_received, rejected, follow_up, note, viewed, custom", () => {
    for (const t of ["application_sent", "interview_scheduled", "offer_received", "rejected", "follow_up", "note", "viewed", "custom"])
      expect(src).toContain(`'${t}'`);
  });

  it("TYPE_CFG: icon + color per tipo + cfg() fallback a custom", () => {
    expect(src).toContain("TYPE_CFG");
    expect(src).toContain("icon:"); expect(src).toContain("color:");
    expect(src).toContain("function cfg"); expect(src).toContain("TYPE_CFG[type] ?? TYPE_CFG.custom");
  });

  it("EventNode: dot+line left, title+date, description, meta", () => {
    expect(src).toContain("function EventNode");
    expect(src).toContain("rounded-full"); // dot
    expect(src).toContain("w-px"); // vertical line
    expect(src).toContain("{event.title}"); expect(src).toContain("{event.date}");
    expect(src).toContain("{event.description}"); expect(src).toContain("{event.meta}");
  });

  it("Timeline: empty 'Nessun evento' + compact mode + events.map", () => {
    expect(src).toContain("Nessun evento"); expect(src).toContain("compact");
    expect(src).toContain("events.map((e, i) =>"); expect(src).toContain("last={i === events.length - 1}");
  });

  it("TimelineCard: wrapped con title, border panel, passa compact a Timeline", () => {
    expect(src).toContain("type TimelineCardProps = TimelineProps & { title?: string }");
    expect(src).toContain("rounded-xl"); expect(src).toContain("var(--color-panel)");
    expect(src).toContain("tracking-widest"); expect(src).toContain("<Timeline events={events}");
  });
});
