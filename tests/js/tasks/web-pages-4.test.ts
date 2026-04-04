/** Test E2E vitest batch 4 — API routes 200 + rendering: budget, env, pipelines, changelog, workers, git, validators, skills, sentinel. */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
  NextRequest: class extends Request {
    nextUrl: URL;
    constructor(input: string | URL, init?: RequestInit) {
      super(input, init);
      this.nextUrl = new URL(typeof input === "string" ? input : input.toString());
    }
  },
}));

const WEB = path.resolve(__dirname, "../../../web/app");

describe("API /api/budget", () => {
  it("GET → 200 con daily array e velocity_history", async () => {
    const { GET } = await import("../../../web/app/api/budget/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.daily)).toBe(true);
    expect(Array.isArray(data.velocity_history)).toBe(true);
  });
});

describe("API /api/env", () => {
  it("GET → 200 con vars array, total, setCount", async () => {
    const { GET } = await import("../../../web/app/api/env/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.vars)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(typeof data.setCount).toBe("number");
    expect(data.total).toBeGreaterThanOrEqual(data.setCount);
  });
});

describe("API /api/pipelines", () => {
  it("GET → 200 con pipelines array e source", async () => {
    const { GET } = await import("../../../web/app/api/pipelines/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.pipelines)).toBe(true);
    expect(data.pipelines.length).toBeGreaterThan(0);
    expect(["static", "github"]).toContain(data.source);
    expect(data.repo).toBeDefined();
  });
});

describe("API /api/changelog", () => {
  it("GET → 200 con releases array e total", async () => {
    const { GET } = await import("../../../web/app/api/changelog/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.releases)).toBe(true);
    expect(typeof data.total).toBe("number");
  });
});

describe("API /api/workers", () => {
  it("GET → 200 con workers array e contatori", async () => {
    const { GET } = await import("../../../web/app/api/workers/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.workers)).toBe(true);
    expect(data.workers.length).toBeGreaterThan(0);
    expect(typeof data.activeCount).toBe("number");
    expect(typeof data.onlineCount).toBe("number");
    expect(typeof data.total).toBe("number");
  });
});

describe("API /api/git", () => {
  it("GET → 200 con branches array e currentBranch", async () => {
    const { GET } = await import("../../../web/app/api/git/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.branches)).toBe(true);
    expect(typeof data.currentBranch).toBe("string");
    expect(typeof data.totalBranches).toBe("number");
  });
});

describe("API /api/validators", () => {
  it("GET → 200 con validators array e total", async () => {
    const { GET } = await import("../../../web/app/api/validators/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.validators)).toBe(true);
    expect(data.total).toBeGreaterThan(0);
  });
});

describe("API /api/skills", () => {
  it("GET → 200 con skills array", async () => {
    const { GET } = await import("../../../web/app/api/skills/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.skills)).toBe(true);
  });
});

describe("pagine batch 4 — rendering e struttura", () => {
  const pages = [
    { route: "budget",     file: "budget/page.tsx",     heading: "Budget API",      fetch: "/api/budget" },
    { route: "env",        file: "env/page.tsx",        heading: "Variabili",       fetch: "/api/env" },
    { route: "pipelines",  file: "pipelines/page.tsx",  heading: "Pipelines",       fetch: "/api/pipelines" },
    { route: "changelog",  file: "changelog/page.tsx",  heading: "Changelog",       fetch: "/api/changelog" },
    { route: "workers",    file: "workers/page.tsx",    heading: "Workers",         fetch: "/api/workers" },
    { route: "git",        file: "git/page.tsx",        heading: "Git",             fetch: "/api/git" },
    { route: "validators", file: "validators/page.tsx", heading: "Validators",      fetch: "/api/validators" },
    { route: "skills",     file: "skills/page.tsx",     heading: "Skills",          fetch: "/api/skills" },
    { route: "sentinel",   file: "sentinel/page.tsx",   heading: "Sentinel",        fetch: "/api/sentinel" },
  ];
  for (const p of pages) {
    it(`/${p.route}: 'use client', heading "${p.heading}", fetch ${p.fetch}`, () => {
      const content = fs.readFileSync(path.join(WEB, p.file), "utf-8");
      expect(content).toContain("use client");
      expect(content).toContain(p.heading);
      expect(content).toContain(p.fetch);
      expect(content).toMatch(/export default function/);
    });
  }
});
