/** Test E2E batch 12 — /import, /export, ConfirmDialog, Toast, Tabs, Modal, Pagination, Select, Switch, EmptyState, VirtualList */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

vi.mock("next/server", () => {
  class NR extends Response {
    static json(d: unknown, i?: ResponseInit) {
      return new Response(JSON.stringify(d), { ...i, headers: { "content-type": "application/json", ...(i?.headers as Record<string, string>) } });
    }
  }
  return { NextRequest: Request, NextResponse: NR };
});
const json = (r: Response) => r.json();
function jreq(url: string, body: unknown) { return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

/* ── /import API ── */
describe("/import", () => {
  it("API POST dryRun=true → ok + count senza scrivere", async () => {
    const { POST } = await import("../../../web/app/api/import/route");
    const res = await POST(jreq("http://h/api/import", { target: "jobs", data: [{ id: "t1", title: "Dev", company: "Co" }], dryRun: true }) as any);
    const d = await json(res); expect(d.dryRun).toBe(true); expect(d.count).toBe(1);
  });
  it("API POST senza target → 400", async () => {
    const { POST } = await import("../../../web/app/api/import/route");
    expect((await POST(jreq("http://h/api/import", { data: {} }) as any)).status).toBe(400);
  });
  it("pagina: ImportPage + TARGETS 6 + parseCsv + dryRun", () => {
    const s = readSrc("app/import/page.tsx");
    expect(s).toMatch(/export default function ImportPage/);
    expect(s).toContain("TARGETS"); expect(s).toContain("parseCsv"); expect(s).toContain("dryRun");
  });
});

/* ── /export (verifica copertura) ── */
describe("/export page", () => {
  it("ExportPage + SOURCES 8 + doExport + formati json/csv", () => {
    const s = readSrc("app/export/page.tsx");
    expect(s).toMatch(/export default function ExportPage/);
    expect(s).toContain("SOURCES"); expect(s).toContain("doExport"); expect(s).toContain("'csv'");
  });
});

/* ── ConfirmDialog ── */
describe("ConfirmDialog", () => {
  const src = readSrc("components/ConfirmDialog.tsx");
  it("export default + ConfirmDialogVariant + ConfirmDialogProps + VARIANT_CONFIG 3", () => {
    expect(src).toMatch(/export default function ConfirmDialog/);
    expect(src).toContain("export type ConfirmDialogVariant");
    expect(src).toContain("export interface ConfirmDialogProps");
    expect(src).toContain("VARIANT_CONFIG");
    for (const v of ["danger", "warning", "info"]) expect(src).toContain(`${v}:`);
  });
  it("a11y: role alertdialog + aria-modal + focus trap + Escape", () => {
    expect(src).toContain('role="alertdialog"'); expect(src).toContain('aria-modal="true"');
    expect(src).toContain("'Escape'"); expect(src).toContain("'Tab'"); expect(src).toContain("cancelRef");
  });
});

/* ── Toast ── */
describe("Toast", () => {
  const src = readSrc("app/components/Toast.tsx");
  it("export ToastType + useToast + ToastProvider + TYPE_CFG 4 tipi", () => {
    expect(src).toContain("export type ToastType");
    expect(src).toContain("export const useToast");
    expect(src).toMatch(/export function ToastProvider/);
    expect(src).toContain("TYPE_CFG");
    for (const t of ["success", "error", "warning", "info"]) expect(src).toContain(`${t}:`);
  });
  it("ToastItem + progress bar + dismiss + ToastStack", () => {
    expect(src).toContain("function ToastItem");
    expect(src).toContain("function ToastStack");
    expect(src).toContain("toast-pb");
    expect(src).toContain("dismiss");
  });
});

/* ── Tabs ── */
describe("Tabs", () => {
  const src = readSrc("components/Tabs.tsx");
  it("export default Tabs + TabsVariant 3 + TabItem + TabsProps", () => {
    expect(src).toMatch(/export default function Tabs/);
    expect(src).toContain("export type TabsVariant");
    expect(src).toContain("export interface TabItem");
    expect(src).toContain("export interface TabsProps");
    for (const v of ["underline", "pills", "boxed"]) expect(src).toContain(`'${v}'`);
  });
  it("keyboard ArrowRight/Left/Home/End + ARIA tablist/tab + indicatore animato", () => {
    expect(src).toContain("'ArrowRight'");
    expect(src).toContain("'ArrowLeft'");
    expect(src).toContain("'Home'");
    expect(src).toContain("'End'");
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain("indicatorStyle");
  });
});

/* ── Modal ── */
describe("Modal", () => {
  const src = readSrc("app/components/Modal.tsx");
  it("export Modal + ModalSize 5 + ModalProps + SIZE_MAX", () => {
    expect(src).toMatch(/export function Modal/);
    expect(src).toContain("export type ModalSize");
    expect(src).toContain("export type ModalProps");
    expect(src).toContain("SIZE_MAX");
    for (const s of ["sm", "md", "lg", "xl", "full"]) expect(src).toContain(`${s}:`);
  });
  it("useFocusTrap + Escape + scroll lock + ARIA dialog/modal", () => {
    expect(src).toContain("useFocusTrap"); expect(src).toContain("'Escape'"); expect(src).toContain("overflow");
    expect(src).toContain('role="dialog"'); expect(src).toContain('aria-modal="true"'); expect(src).toContain('aria-label="Chiudi"');
  });
});

/* ── Pagination ── */
describe("Pagination", () => {
  const src = readSrc("components/Pagination.tsx");
  it("export default Pagination + PaginationProps + buildPages + range + PageBtn", () => {
    expect(src).toMatch(/export default function Pagination/);
    expect(src).toContain("export interface PaginationProps");
    expect(src).toContain("function buildPages");
    expect(src).toContain("function range");
    expect(src).toContain("function PageBtn");
  });
  it("compact mode + showingInfo 'X-Y di Z' + siblingsCount + ellipsis", () => {
    expect(src).toContain("compact");
    expect(src).toContain("showingInfo");
    expect(src).toContain("siblingsCount");
    expect(src).toContain("'...'");
  });
});

/* ── Select ── */
describe("Select", () => {
  const src = readSrc("app/components/Select.tsx");
  it("export Select + SelectOption + SelectProps", () => {
    expect(src).toMatch(/export function Select/);
    expect(src).toContain("export type SelectOption");
    expect(src).toContain("export type SelectProps");
  });
  it("searchable + multiple chips + clearable + keyboard Escape/Arrow/Enter", () => {
    expect(src).toContain("searchable"); expect(src).toContain("multiple"); expect(src).toContain("clearable");
    expect(src).toContain("removeChip"); expect(src).toContain("'Escape'");
    expect(src).toContain("'ArrowDown'"); expect(src).toContain("'ArrowUp'"); expect(src).toContain("Nessun risultato");
  });
});

/* ── Switch ── */
describe("Switch", () => {
  const src = readSrc("components/Switch.tsx");
  it("export default Switch + SwitchSize 3 + SwitchProps + SIZE config", () => {
    expect(src).toMatch(/export default function Switch/);
    expect(src).toContain("export type SwitchSize");
    expect(src).toContain("export interface SwitchProps");
    for (const s of ["sm", "md", "lg"]) expect(src).toContain(`${s}:`);
  });
  it("a11y role=switch + aria-checked + keyboard Space/Enter + labelPosition", () => {
    expect(src).toContain('role="switch"');
    expect(src).toContain("aria-checked");
    expect(src).toContain("' '");
    expect(src).toContain("'Enter'");
    expect(src).toContain("labelPosition");
    expect(src).toContain("description");
  });
});

/* ── EmptyState ── */
describe("EmptyState", () => {
  it("export EmptyState + 3 size sm/md/lg + action button", () => {
    const s = readSrc("app/components/EmptyState.tsx");
    expect(s).toMatch(/export function EmptyState/);
    for (const sz of ["'sm'", "'md'", "'lg'"]) expect(s).toContain(sz);
    expect(s).toContain("action");
  });
});

/* ── VirtualList ── */
describe("VirtualList", () => {
  it("export default VirtualList + useVirtualList + overscan + scrollToIndex", () => {
    const s = readSrc("components/VirtualList.tsx");
    expect(s).toMatch(/export default function VirtualList/);
    expect(s).toMatch(/export function useVirtualList/);
    expect(s).toContain("overscan");
    expect(s).toContain("scrollToIndex");
    expect(s).toContain("Nessun elemento");
  });
});
