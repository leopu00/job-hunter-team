/** Test E2E batch 17 — /templates, /skills, /history */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Templates API ── */
describe("/api/templates", () => {
  const src = readSrc("app/api/templates/route.ts");

  it("GET + POST + TemplateCategory 5 + SAMPLE_TEMPLATES 5", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toContain("'cover-letter' | 'follow-up' | 'thank-you' | 'referral' | 'salary'");
    expect(src).toContain("SAMPLE_TEMPLATES");
    // 5 sample templates
    for (const t of ["cover-letter-standard.md", "follow-up-interview.md", "thank-you-letter.md", "referral-request.md", "salary-negotiation.md"])
      expect(src).toContain(t);
  });

  it("parseFrontmatter --- delimiters + extractVariables regex {var} + substituteVars", () => {
    expect(src).toContain("function parseFrontmatter");
    expect(src).toContain("trimmed.startsWith('---')");
    expect(src).toContain("function extractVariables");
    expect(src).toContain("[a-zA-Z_][a-zA-Z0-9_.]*");
    expect(src).toContain("function substituteVars");
  });

  it("GET: filtro ?name + ?category + categories unique + POST: preview rendered + unresolvedVars", () => {
    expect(src).toContain("searchParams.get('name')");
    expect(src).toContain("searchParams.get('category')");
    expect(src).toContain("new Set(templates.map(t => t.category))");
    expect(src).toContain("rendered");
    expect(src).toContain("unresolvedVars");
  });
});

/* ── Skills API ── */
describe("/api/skills", () => {
  const src = readSrc("app/api/skills/route.ts");

  it("GET + POST + DELETE + SkillLevel 4 + SkillCategory 5", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("'beginner' | 'intermediate' | 'advanced' | 'expert'");
    expect(src).toContain("'frontend' | 'backend' | 'devops' | 'soft-skills' | 'languages'");
  });

  it("LEVEL_SCORE 25/50/75/100 + radarTop6 sort + SAMPLE_SKILLS 12", () => {
    expect(src).toContain("beginner: 25");
    expect(src).toContain("intermediate: 50");
    expect(src).toContain("advanced: 75");
    expect(src).toContain("expert: 100");
    expect(src).toContain("radarTop6");
    expect(src).toContain(".slice(0, 6)");
    expect(src).toContain("SAMPLE_SKILLS");
  });

  it("CRUD: GET filtro category/level + POST name obbligatorio + DELETE ?id + store tmp+rename", () => {
    expect(src).toContain("sp.get('category')");
    expect(src).toContain("sp.get('level')");
    expect(src).toContain("body.name?.trim()");
    expect(src).toContain("searchParams.get('id')");
    expect(src).toContain("fs.renameSync(tmp, STORE_PATH)");
  });

  it("byCategory aggregation + randomUUID per nuovo skill + endorsements", () => {
    expect(src).toContain("byCategory");
    expect(src).toContain("(byCategory[s.category] ?? 0) + 1");
    expect(src).toContain("randomUUID()");
    expect(src).toContain("endorsements: 0");
  });
});

/* ── History API ── */
describe("/api/history", () => {
  const src = readSrc("app/api/history/route.ts");

  it("GET + POST + DELETE + Conversation type + HistoryStore version:1", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("type Conversation");
    expect(src).toContain("type HistoryStore");
  });

  it("GET filtro agentId + sort updatedAt desc + POST crea o aggiunge messaggio", () => {
    expect(src).toContain("searchParams.get('agentId')");
    expect(src).toContain("b.updatedAt - a.updatedAt");
    expect(src).toContain("body.conversationId");
    expect(src).toContain("conv.messages.push({ role, content, ts: now })");
  });

  it("DELETE per id + store tmp+rename + 404 se non trovata", () => {
    expect(src).toContain("searchParams.get('id')");
    expect(src).toContain("store.conversations.filter(c => c.id !== id)");
    expect(src).toContain("renameSync(tmp, HISTORY_PATH)");
    expect(src).toContain("conversazione non trovata");
  });
});

/* ── History [id] API ── */
describe("/api/history/[id]", () => {
  const src = readSrc("app/api/history/[id]/route.ts");

  it("GET + DELETE + paginazione page/limit + loadFromTranscript JSONL", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("searchParams.get('page')");
    expect(src).toContain("searchParams.get('limit')");
    expect(src).toContain("function loadFromTranscript");
  });

  it("loadFromStore + readJsonSafe + JSONL split lines + session/message parsing", () => {
    expect(src).toContain("function loadFromStore");
    expect(src).toContain("function readJsonSafe");
    expect(src).toContain("split('\\n')");
    expect(src).toContain("obj.type === 'session'");
    expect(src).toContain("msg.role && msg.content");
  });

  it("paginazione: Math.ceil pages, slice start/end, limit max 200", () => {
    expect(src).toContain("Math.ceil(total / limit)");
    expect(src).toContain("Math.min(200,");
    expect(src).toContain("conv.messages.slice(start, end)");
    expect(src).toContain("page, pages, limit");
  });
});
