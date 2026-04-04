/** Test vitest componenti UI batch 4 — Banner, CountdownTimer, Popover, ImageGallery, ColorPicker, Breadcrumb, Sidebar, DataTable */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Banner ── */
describe("Banner", () => {
  const src = read("components/Banner.tsx");
  it("export default Banner + BannerProps + BannerVariant + BannerAction", () => {
    expect(src).toMatch(/export default function Banner/);
    expect(src).toContain("export interface BannerProps");
    expect(src).toContain("export type BannerVariant");
    expect(src).toContain("export interface BannerAction");
  });
  it("VARIANT_CONFIG 4 varianti: info, warning, error, success", () => {
    expect(src).toContain("VARIANT_CONFIG");
    for (const v of ["info", "warning", "error", "success"])
      expect(src).toContain(`${v}:`);
  });
  it("dismissible + role alert + animazione dismiss", () => {
    expect(src).toContain("dismissible");
    expect(src).toContain('role="alert"');
    expect(src).toContain("setHiding");
    expect(src).toContain('aria-label="Chiudi"');
  });
});

/* ── CountdownTimer ── */
describe("CountdownTimer", () => {
  const src = read("app/components/CountdownTimer.tsx");
  it("export CountdownTimer + CountdownBadge + CountdownTimerProps", () => {
    expect(src).toMatch(/export function CountdownTimer/);
    expect(src).toMatch(/export function CountdownBadge/);
    expect(src).toContain("export type CountdownTimerProps");
  });
  it("helper remaining, fmt, urgencyColor, urgencyLabel, pad", () => {
    for (const f of ["remaining", "fmt", "urgencyColor", "urgencyLabel", "pad"])
      expect(src).toContain(`function ${f}`);
  });
  it("4 label urgenza: Scaduto, Urgente, Imminente, In scadenza + 3 size sm/md/lg", () => {
    for (const l of ["Scaduto", "Urgente", "Imminente", "In scadenza"])
      expect(src).toContain(`'${l}'`);
    expect(src).toContain("'sm'");
    expect(src).toContain("'md'");
    expect(src).toContain("'lg'");
  });
});

/* ── Popover ── */
describe("Popover", () => {
  const src = read("app/components/Popover.tsx");
  it("export Popover + usePopover hook + PopoverProps + PopoverPlacement + PopoverTrigger", () => {
    expect(src).toMatch(/export function Popover\b/);
    expect(src).toMatch(/export function usePopover/);
    expect(src).toContain("export type PopoverProps");
    expect(src).toContain("export type PopoverPlacement");
    expect(src).toContain("export type PopoverTrigger");
  });
  it("trigger click/hover + placement auto/top/bottom/left/right + role dialog", () => {
    expect(src).toContain("'click'");
    expect(src).toContain("'hover'");
    expect(src).toContain("'auto'");
    expect(src).toContain('role="dialog"');
  });
  it("autoSide + popStyle + arrowStyle + ESC dismiss + click-outside", () => {
    expect(src).toContain("function autoSide");
    expect(src).toContain("function popStyle");
    expect(src).toContain("function arrowStyle");
    expect(src).toContain("'Escape'");
    expect(src).toContain("mousedown");
  });
});

/* ── ImageGallery ── */
describe("ImageGallery", () => {
  const src = read("app/components/ImageGallery.tsx");
  it("export ImageGallery + GalleryImage + ImageGalleryProps", () => {
    expect(src).toMatch(/export function ImageGallery/);
    expect(src).toContain("export type GalleryImage");
    expect(src).toContain("export type ImageGalleryProps");
  });
  it("Lightbox sub-componente con keyboard nav (Escape, ArrowLeft, ArrowRight, zoom Z)", () => {
    expect(src).toContain("function Lightbox");
    expect(src).toContain("'Escape'");
    expect(src).toContain("'ArrowLeft'");
    expect(src).toContain("'ArrowRight'");
    expect(src).toContain("'z'");
  });
  it("zoom toggle + caption + dots indicatore + grid columns", () => {
    expect(src).toContain("zoom");
    expect(src).toContain("caption");
    expect(src).toContain("gridTemplateColumns");
    expect(src).toContain("zoom-in");
    expect(src).toContain("zoom-out");
  });
});

/* ── ColorPicker ── */
describe("ColorPicker", () => {
  const src = read("components/ColorPicker.tsx");
  it("export default ColorPicker + ColorPickerProps + PALETTE 12 colori", () => {
    expect(src).toMatch(/export default function ColorPicker/);
    expect(src).toContain("export interface ColorPickerProps");
    expect(src).toContain("PALETTE");
    const m = src.match(/'#[0-9a-fA-F]{6}'/g);
    expect(m!.length).toBeGreaterThanOrEqual(12);
  });
  it("isValidHex + contrastColor + hex input con validazione", () => {
    expect(src).toContain("function isValidHex");
    expect(src).toContain("function contrastColor");
    expect(src).toContain("hexError");
    expect(src).toContain("handleHexChange");
    expect(src).toContain("handleHexBlur");
  });
});

/* ── Breadcrumb ── */
describe("Breadcrumb", () => {
  const src = read("app/components/Breadcrumb.tsx");
  it("export default Breadcrumb + LABELS map + segLabel helper", () => {
    expect(src).toMatch(/export default function Breadcrumb/);
    expect(src).toContain("LABELS");
    expect(src).toContain("function segLabel");
  });
  it("CollapseDropdown + CopyPath + MAX_VISIBLE + HIDDEN_PATHS", () => {
    expect(src).toContain("function CollapseDropdown");
    expect(src).toContain("function CopyPath");
    expect(src).toContain("MAX_VISIBLE");
    expect(src).toContain("HIDDEN_PATHS");
  });
  it("aria-label breadcrumb + NotificationCenter integrato", () => {
    expect(src).toContain('aria-label="breadcrumb"');
    expect(src).toContain("NotificationCenter");
  });
});

/* ── DataTable ── */
describe("DataTable", () => {
  const src = read("components/DataTable.tsx");
  it("export default DataTable + DataColumn + DataTableProps", () => {
    expect(src).toMatch(/export default function DataTable/);
    expect(src).toContain("export interface DataColumn");
    expect(src).toContain("export interface DataTableProps");
  });
  it("sorting asc/desc + column resize + select all/row", () => {
    expect(src).toContain("'asc'");
    expect(src).toContain("'desc'");
    expect(src).toContain("handleSort");
    expect(src).toContain("startResize");
    expect(src).toContain("toggleAll");
    expect(src).toContain("toggleRow");
  });
  it("CSV export: toCSV + downloadCSV + toolbar conteggio righe + 'Nessun dato'", () => {
    expect(src).toContain("function toCSV");
    expect(src).toContain("function downloadCSV");
    expect(src).toContain("CSV");
    expect(src).toContain("Nessun dato");
  });
});
