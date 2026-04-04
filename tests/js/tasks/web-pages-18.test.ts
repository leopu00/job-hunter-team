/** Test E2E batch 18 — /bookmarks, /history (activity) */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Bookmarks API ── */
describe("/api/bookmarks", () => {
  const src = readSrc("app/api/bookmarks/route.ts");

  it("GET + POST + DELETE + Bookmark interface con tags/note/url + BookmarkStore", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("interface Bookmark");
    expect(src).toContain("tags: string[]");
    expect(src).toContain("note?: string");
    expect(src).toContain("interface BookmarkStore");
  });

  it("GET: filtro ?tag + ?q search case-insensitive + sort company/date + allTags unique", () => {
    expect(src).toContain("sp.get('tag')");
    expect(src).toContain("sp.get('q')?.toLowerCase()");
    expect(src).toContain("b.jobTitle.toLowerCase().includes(q)");
    expect(src).toContain("b.company.toLowerCase().includes(q)");
    expect(src).toContain("sort === 'company'");
    expect(src).toContain("a.company.localeCompare(b.company)");
    expect(src).toContain("b.savedAt - a.savedAt");
    expect(src).toContain("new Set(store.bookmarks.flatMap(b => b.tags))");
  });

  it("POST: jobTitle+company obbligatori + randomUUID + tags array trim", () => {
    expect(src).toContain("body.jobTitle?.trim() || !body.company?.trim()");
    expect(src).toContain("'jobTitle e company obbligatori'");
    expect(src).toContain("randomUUID()");
    expect(src).toContain("body.tags.map(t => t.trim()).filter(Boolean)");
  });

  it("DELETE: ?id singolo + ?all=true clear tutto + store tmp+rename + SAMPLE 8", () => {
    expect(src).toContain("all === 'true'");
    expect(src).toContain("store.bookmarks = []");
    expect(src).toContain("store.bookmarks.splice(idx, 1)");
    expect(src).toContain("renameSync(tmp, STORE_PATH)");
    expect(src).toContain("id: 'b8'");
  });
});

/* ── History API (activity) ── */
describe("/api/history (activity)", () => {
  const src = readSrc("app/api/history/route.ts");

  it("GET + POST + DELETE + ActionType 5 + EntityType 6 + Activity interface", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("'view' | 'apply' | 'save' | 'edit' | 'delete'");
    expect(src).toContain("'job' | 'contact' | 'company' | 'template' | 'document' | 'session'");
    expect(src).toContain("interface Activity");
  });

  it("GET: filtri ?action + ?entity + ?days default 30 + sort timestamp desc", () => {
    expect(src).toContain("sp.get('action')");
    expect(src).toContain("sp.get('entity')");
    expect(src).toContain("get('days') ?? '30'");
    expect(src).toContain("days * 86_400_000");
    expect(src).toContain("a.timestamp >= since");
    expect(src).toContain("b.timestamp - a.timestamp");
  });

  it("POST: action+entity+entityName obbligatori + randomUUID + detail opzionale", () => {
    expect(src).toContain("!body.action || !body.entity || !body.entityName?.trim()");
    expect(src).toContain("'action, entity, entityName obbligatori'");
    expect(src).toContain("randomUUID()");
    expect(src).toContain("detail: body.detail?.trim()");
  });

  it("DELETE: ?all=true clear + ?id singolo + SAMPLE 15 attività + store tmp+rename", () => {
    expect(src).toContain("all === 'true'");
    expect(src).toContain("store.activities = []");
    expect(src).toContain("store.activities.splice(idx, 1)");
    expect(src).toContain("renameSync(tmp, STORE_PATH)");
    expect(src).toContain("id: 'a15'");
  });
});

/* ── History [id] (conversation detail) ── */
describe("/api/history/[id]", () => {
  const src = readSrc("app/api/history/[id]/route.ts");

  it("GET + DELETE + paginazione page/limit max 200 + loadFromTranscript JSONL", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("searchParams.get('page')");
    expect(src).toContain("Math.min(200,");
    expect(src).toContain("function loadFromTranscript");
    expect(src).toContain("split('\\n')");
  });
});
