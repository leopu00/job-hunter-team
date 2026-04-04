/** Test E2E batch 15 — /notifications API, Drawer, LoadingButton/Button/IconButton (Carousel non esiste) */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Notifications API ── */
describe("Notifications API", () => {
  const src = readSrc("app/api/notifications/route.ts");

  it("export GET + POST + PATCH + DELETE + dynamic force-dynamic", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toMatch(/export async function PATCH\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("export const dynamic = 'force-dynamic'");
  });

  it("types: NotificationPriority 4 + NotificationChannel 3 + StoredNotification + NotificationStore", () => {
    expect(src).toContain("type NotificationPriority");
    for (const p of ["low", "normal", "high", "urgent"]) expect(src).toContain(`'${p}'`);
    expect(src).toContain("type NotificationChannel");
    for (const c of ["desktop", "telegram", "web"]) expect(src).toContain(`'${c}'`);
    expect(src).toContain("interface StoredNotification");
    expect(src).toContain("interface NotificationStore");
  });

  it("GET: filtra priority/channel/unread, sort timestamp desc, returns notifications+total+unreadCount", () => {
    expect(src).toContain("sp.get('priority')"); expect(src).toContain("sp.get('channel')");
    expect(src).toContain("sp.get('unread')"); expect(src).toContain("b.timestamp - a.timestamp");
    expect(src).toContain("notifications: items, total: items.length, unreadCount");
  });

  it("POST: valida title+body obbligatori, randomUUID, channel default 'web', status 201", () => {
    expect(src).toContain("!body.title?.trim() || !body.body?.trim()");
    expect(src).toContain("title e body obbligatori"); expect(src).toContain("status: 400");
    expect(src).toContain("randomUUID()");
    expect(src).toContain("body.channel ?? 'web'"); expect(src).toContain("body.priority ?? 'normal'");
    expect(src).toContain("status: 201");
  });

  it("PATCH: mark-as-read by id o all=true + DELETE: by id o read=true", () => {
    expect(src).toContain("all === 'true'"); expect(src).toContain("markedRead: count");
    expect(src).toContain("notifica non trovata"); expect(src).toContain("status: 404");
    expect(src).toContain("store.notifications.filter(n => !n.read)"); // DELETE read
    expect(src).toContain("splice(idx, 1)");
  });

  it("store: load con ENOENT fallback + save atomico tmp+rename + mkdirSync recursive", () => {
    expect(src).toContain("function load"); expect(src).toContain("function save");
    expect(src).toContain("e.code === 'ENOENT'"); expect(src).toContain("function empty");
    expect(src).toContain("STORE_PATH + '.tmp'"); expect(src).toContain("fs.renameSync");
    expect(src).toContain("mkdirSync(dir, { recursive: true })");
  });
});

/* ── Drawer ── */
describe("Drawer", () => {
  const src = readSrc("app/components/Drawer.tsx");

  it("export Drawer + useDrawer + tipi DrawerPosition/DrawerSize + DrawerProps", () => {
    expect(src).toMatch(/export function Drawer\b/);
    expect(src).toMatch(/export function useDrawer\b/);
    expect(src).toContain("export type DrawerPosition"); expect(src).toContain("export type DrawerSize");
    expect(src).toContain("export interface DrawerProps");
  });

  it("SIZE_W: sm 320px, md 420px, lg 560px, full 100vw", () => {
    expect(src).toContain("SIZE_W");
    expect(src).toContain("'320px'"); expect(src).toContain("'420px'");
    expect(src).toContain("'560px'"); expect(src).toContain("'100vw'");
  });

  it("useFocusTrap: Tab trap + focus first element + keydown listener", () => {
    expect(src).toContain("function useFocusTrap");
    expect(src).toContain("e.key !== 'Tab'"); expect(src).toContain("e.shiftKey");
    expect(src).toContain("first.focus()"); expect(src).toContain("last.focus()");
  });

  it("role='dialog' + aria-modal + aria-label + Escape + scroll lock body", () => {
    expect(src).toContain('role="dialog"'); expect(src).toContain('aria-modal="true"');
    expect(src).toContain("aria-label={title}");
    expect(src).toContain("e.key === 'Escape'"); expect(src).toContain("overflow = 'hidden'");
  });

  it("position left/right: slide animations + overlay + footer slot + aria-label='Chiudi'", () => {
    expect(src).toContain("drawer-slide-right"); expect(src).toContain("drawer-slide-left");
    expect(src).toContain("drawer-overlay-in"); expect(src).toContain("rgba(0,0,0,0.55)");
    expect(src).toContain("{footer}"); expect(src).toContain('aria-label="Chiudi"');
  });

  it("useDrawer hook: open state + onOpen + onClose", () => {
    expect(src).toContain("useState(false)");
    expect(src).toContain("onOpen: () => setOpen(true)");
    expect(src).toContain("onClose: () => setOpen(false)");
  });
});

/* ── LoadingButton / Button / ButtonGroup / IconButton ── */
describe("LoadingButton", () => {
  const src = readSrc("app/components/LoadingButton.tsx");

  it("export Button + LoadingButton + ButtonGroup + IconButton + tipi", () => {
    expect(src).toMatch(/export function Button\b/);
    expect(src).toMatch(/export function LoadingButton\b/);
    expect(src).toMatch(/export function ButtonGroup\b/);
    expect(src).toMatch(/export function IconButton\b/);
    expect(src).toContain("export type ButtonVariant"); expect(src).toContain("export type ButtonSize");
    expect(src).toContain("export interface ButtonProps");
    expect(src).toContain("export interface ButtonGroupProps");
    expect(src).toContain("export interface IconButtonProps");
  });

  it("ButtonVariant 4 + VARIANT_STYLE + VARIANT_HOVER + SIZE_CLS sm/md/lg", () => {
    for (const v of ["primary", "secondary", "danger", "ghost"]) expect(src).toContain(`${v}:`);
    expect(src).toContain("VARIANT_STYLE"); expect(src).toContain("VARIANT_HOVER"); expect(src).toContain("SIZE_CLS");
    expect(src).toContain("btn-hover-primary"); expect(src).toContain("btn-hover-ghost");
  });

  it("Spinner animate-spin + loading state: disabled + loadingText + SPINNER_SIZE", () => {
    expect(src).toContain("function Spinner"); expect(src).toContain("animate-spin");
    expect(src).toContain("borderTopColor: 'transparent'"); expect(src).toContain("SPINNER_SIZE");
    expect(src).toContain("disabled || loading"); // isDisabled
    expect(src).toContain("loading && loadingText ? loadingText : children");
  });

  it("icon left/right + fullWidth + ButtonGroup gap/vertical", () => {
    expect(src).toContain("iconPosition?: 'left' | 'right'");
    expect(src).toContain("iconPosition === 'left'"); expect(src).toContain("iconPosition === 'right'");
    expect(src).toContain("fullWidth ? 'w-full'");
    expect(src).toContain("vertical ? 'flex-col' : 'flex-row flex-wrap'");
    for (const g of ["gap-1", "gap-2", "gap-3"]) expect(src).toContain(g);
  });

  it("IconButton: aria-label obbligatorio + ICON_SIZE sm/md/lg + spinner on loading", () => {
    expect(src).toContain("label:     string   // aria-label obbligatorio");
    expect(src).toContain("aria-label={label}"); expect(src).toContain("ICON_SIZE");
    expect(src).toContain("w-7 h-7"); expect(src).toContain("w-8 h-8"); expect(src).toContain("w-10 h-10");
    expect(src).toContain("loading ? <Spinner");
  });
});
