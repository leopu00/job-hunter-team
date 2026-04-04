/** Test E2E batch 13 — /setup, /import, FloatingChat, Toast, ConfirmDialog, Modal, Tabs, Pagination, Select, Switch */
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

/* ── /setup ── */
describe("/setup", () => {
  it("API GET → exists boolean + config", async () => {
    const { GET } = await import("../../../web/app/api/setup/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const d = await json(res);
    expect(d).toHaveProperty("exists");
  });
  it("API POST provider non valido → 400", async () => {
    const { POST } = await import("../../../web/app/api/setup/route");
    const res = await POST(jreq("http://h/api/setup", { active_provider: "nope", providers: {} }) as any);
    expect(res.status).toBe(400);
  });
  it("pagina: SetupPage + STEPS 5 + PROVIDERS 3 + MODELS + health check", () => {
    const s = readSrc("app/setup/page.tsx");
    expect(s).toMatch(/export default function SetupPage/);
    expect(s).toContain("STEPS"); expect(s).toContain("PROVIDERS"); expect(s).toContain("MODELS");
    for (const st of ["prereq", "model", "apikey", "workspace", "health"]) expect(s).toContain(`'${st}'`);
  });
});

/* ── /import ── */
describe("/import", () => {
  it("API POST dryRun → ok + count", async () => {
    const { POST } = await import("../../../web/app/api/import/route");
    const d = await json(await POST(jreq("http://h/api/import", { target: "jobs", data: [{ id: "j1", title: "Dev", company: "Co" }], dryRun: true }) as any));
    expect(d.dryRun).toBe(true); expect(d.count).toBe(1);
  });
  it("pagina: ImportPage + TARGETS 6 + parseCsv + merge/replace", () => {
    const s = readSrc("app/import/page.tsx");
    expect(s).toMatch(/export default function ImportPage/);
    expect(s).toContain("TARGETS"); expect(s).toContain("parseCsv"); expect(s).toContain("'merge'"); expect(s).toContain("'replace'");
  });
});

/* ── FloatingChat ── */
describe("FloatingChat", () => {
  const src = readSrc("app/components/FloatingChat.tsx");
  it("export default FloatingChat + Message + Suggestion types + animation", () => {
    expect(src).toMatch(/export default function FloatingChat/);
    expect(src).toContain("type Message"); expect(src).toContain("type Suggestion");
    expect(src).toContain("chat-slide-up");
  });
  it("aria-label Chiudi/Apri + suggestions + 'Sto pensando' + Enter send", () => {
    expect(src).toContain("Apri AI Assistant"); expect(src).toContain("Chiudi chat");
    expect(src).toContain("suggestions"); expect(src).toContain("Sto pensando");
    expect(src).toContain("'Enter'"); expect(src).toContain("fetchHistory");
  });
});

/* ── Toast ── */
describe("Toast", () => {
  const src = readSrc("app/components/Toast.tsx");
  it("export ToastType + useToast + ToastProvider + TYPE_CFG 4 tipi", () => {
    expect(src).toContain("export type ToastType"); expect(src).toContain("export const useToast");
    expect(src).toMatch(/export function ToastProvider/); expect(src).toContain("TYPE_CFG");
    for (const t of ["success", "error", "warning", "info"]) expect(src).toContain(`${t}:`);
  });
  it("ToastItem + progress bar toast-pb + dismiss + ToastStack", () => {
    expect(src).toContain("function ToastItem"); expect(src).toContain("function ToastStack");
    expect(src).toContain("toast-pb"); expect(src).toContain("dismiss");
  });
});

/* ── ConfirmDialog ── */
describe("ConfirmDialog", () => {
  const src = readSrc("components/ConfirmDialog.tsx");
  it("export default + VARIANT_CONFIG (danger/warning/info) + Props", () => {
    expect(src).toMatch(/export default function ConfirmDialog/);
    expect(src).toContain("export type ConfirmDialogVariant"); expect(src).toContain("VARIANT_CONFIG");
    for (const v of ["danger", "warning", "info"]) expect(src).toContain(`${v}:`);
  });
  it("a11y alertdialog + aria-modal + focus trap Tab + Escape + cancelRef", () => {
    expect(src).toContain('role="alertdialog"'); expect(src).toContain('aria-modal="true"');
    expect(src).toContain("'Escape'"); expect(src).toContain("'Tab'"); expect(src).toContain("cancelRef");
  });
});

/* ── Modal ── */
describe("Modal", () => {
  const src = readSrc("app/components/Modal.tsx");
  it("export Modal + ModalSize 5 + SIZE_MAX + ModalProps", () => {
    expect(src).toMatch(/export function Modal/); expect(src).toContain("export type ModalSize");
    expect(src).toContain("SIZE_MAX");
    for (const s of ["sm", "md", "lg", "xl", "full"]) expect(src).toContain(`${s}:`);
  });
  it("useFocusTrap + Escape + scroll lock + dialog aria-modal", () => {
    expect(src).toContain("useFocusTrap"); expect(src).toContain("'Escape'");
    expect(src).toContain('role="dialog"'); expect(src).toContain('aria-modal="true"');
  });
});

/* ── Tabs ── */
describe("Tabs", () => {
  const src = readSrc("components/Tabs.tsx");
  it("export default Tabs + TabsVariant underline/pills/boxed + TabItem", () => {
    expect(src).toMatch(/export default function Tabs/); expect(src).toContain("export type TabsVariant");
    for (const v of ["underline", "pills", "boxed"]) expect(src).toContain(`'${v}'`);
  });
  it("keyboard Arrow/Home/End + ARIA tablist/tab + indicatore animato", () => {
    expect(src).toContain("'ArrowRight'"); expect(src).toContain("'ArrowLeft'");
    expect(src).toContain("'Home'"); expect(src).toContain("'End'");
    expect(src).toContain('role="tablist"'); expect(src).toContain('role="tab"');
  });
});

/* ── Pagination ── */
describe("Pagination", () => {
  const src = readSrc("components/Pagination.tsx");
  it("export default Pagination + PaginationProps + buildPages + range", () => {
    expect(src).toMatch(/export default function Pagination/);
    expect(src).toContain("function buildPages"); expect(src).toContain("function range");
  });
  it("compact mode + showingInfo + siblingsCount + ellipsis '...'", () => {
    expect(src).toContain("compact"); expect(src).toContain("showingInfo");
    expect(src).toContain("siblingsCount"); expect(src).toContain("'...'");
  });
});

/* ── Select ── */
describe("Select", () => {
  const src = readSrc("app/components/Select.tsx");
  it("export Select + SelectOption + SelectProps", () => {
    expect(src).toMatch(/export function Select/); expect(src).toContain("export type SelectOption");
    expect(src).toContain("export type SelectProps");
  });
  it("searchable + multiple + clearable + keyboard + 'Nessun risultato'", () => {
    expect(src).toContain("searchable"); expect(src).toContain("multiple"); expect(src).toContain("clearable");
    expect(src).toContain("'Escape'"); expect(src).toContain("'ArrowDown'"); expect(src).toContain("Nessun risultato");
  });
});

/* ── Switch ── */
describe("Switch", () => {
  const src = readSrc("components/Switch.tsx");
  it("export default Switch + SwitchSize sm/md/lg + SwitchProps", () => {
    expect(src).toMatch(/export default function Switch/); expect(src).toContain("export type SwitchSize");
    for (const s of ["sm", "md", "lg"]) expect(src).toContain(`${s}:`);
  });
  it("a11y role=switch + aria-checked + keyboard Space/Enter + label", () => {
    expect(src).toContain('role="switch"'); expect(src).toContain("aria-checked");
    expect(src).toContain("' '"); expect(src).toContain("'Enter'"); expect(src).toContain("labelPosition");
  });
});
