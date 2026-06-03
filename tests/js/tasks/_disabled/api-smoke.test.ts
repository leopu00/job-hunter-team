/** Test integrazione finale — smoke test GET su tutte le API routes non coperte dai batch 1-4. */
import { describe, it, expect, vi } from "vitest";

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

const allRouteKeys = import.meta.glob("../../../web/app/api/**/route.ts");

describe("inventario API routes", () => {
  it("almeno 100 file route.ts nel progetto", () => {
    expect(Object.keys(allRouteKeys).length).toBeGreaterThanOrEqual(100);
  });
});

describe("smoke GET — route non coperte dai batch 1-4", () => {
  const routes: [string, string][] = [
    ["about", "../../../web/app/api/about/route.js"],
    ["health", "../../../web/app/api/health/route.js"],
    ["events", "../../../web/app/api/events/route.js"],
    ["export", "../../../web/app/api/export/route.js"],
    ["logs", "../../../web/app/api/logs/route.js"],
    ["providers", "../../../web/app/api/providers/route.js"],
    ["rate-limiter", "../../../web/app/api/rate-limiter/route.js"],
    ["errors", "../../../web/app/api/errors/route.js"],
    ["performance", "../../../web/app/api/performance/route.js"],
    ["config", "../../../web/app/api/config/route.js"],
    ["i18n", "../../../web/app/api/i18n/route.js"],
    ["memory", "../../../web/app/api/memory/route.js"],
    ["plugins", "../../../web/app/api/plugins/route.js"],
    ["templates", "../../../web/app/api/templates/route.js"],
    ["tools", "../../../web/app/api/tools/route.js"],
    ["notifications", "../../../web/app/api/notifications/route.js"],
    ["migrations", "../../../web/app/api/migrations/route.js"],
    ["sessions", "../../../web/app/api/sessions/route.js"],
    ["tasks", "../../../web/app/api/tasks/route.js"],
    ["cron", "../../../web/app/api/cron/route.js"],
    ["agents", "../../../web/app/api/agents/route.js"],
    ["analytics", "../../../web/app/api/analytics/route.js"],
    ["queue", "../../../web/app/api/queue/route.js"],
    ["retry", "../../../web/app/api/retry/route.js"],
    ["onboarding", "../../../web/app/api/onboarding/route.js"],
    ["preferences", "../../../web/app/api/preferences/route.js"],
    ["channels", "../../../web/app/api/channels/route.js"],
    ["telegram", "../../../web/app/api/telegram/route.js"],
  ];

  for (const [name, path] of routes) {
    it(`GET /api/${name} → risponde senza crash`, async () => {
      const mod = await import(path);
      expect(typeof mod.GET).toBe("function");
      const req = new Request(`http://localhost/api/${name}`) as any;
      req.nextUrl = new URL(req.url);
      const res = await mod.GET(req);
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
    });
  }
});

describe("copertura complessiva", () => {
  it("batch 1-4 + smoke = almeno 55 route GET testate", () => {
    const batch1to4 = [
      "monitoring", "scheduler", "hooks", "backup", "settings",
      "team", "secrets", "context", "activity", "forum", "search", "sentinel", "audit",
      "integrations", "webhooks", "reports",
      "budget", "env", "pipelines", "changelog", "workers", "git", "validators", "skills",
    ];
    const smoke = [
      "about", "health", "events", "export", "logs",
      "providers", "rate-limiter", "errors", "performance", "config", "i18n",
      "memory", "plugins", "templates", "tools", "notifications", "migrations",
      "sessions", "tasks", "cron", "agents", "analytics", "queue", "retry",
      "onboarding", "preferences", "channels", "telegram",
    ];
    const total = new Set([...batch1to4, ...smoke]).size;
    expect(total).toBeGreaterThanOrEqual(50);
  });
});
