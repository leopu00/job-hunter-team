/**
 * JHT-T151: le pagine /rate-limiter e /providers dicono quello che la squadra
 * fa davvero.
 *
 * - `/api/rate-limiter` non legge più una chiave `rate_limiter` di
 *   jht.config.json (nessun codice la usa: i valori non frenavano niente): dà il
 *   consumo che la sentinella ha scritto in `logs/role-usage.json`, in sola
 *   lettura, e dice che i limiti non sono configurabili. File assente = «non
 *   so», mai zero; file vecchio = non fresco.
 * - `/api/providers` usa gli id della squadra (claude, codex, kimi), non
 *   anthropic/openai/kimi; non ha elenchi fissi di modelli ma i modelli delle
 *   sessioni accese (`@jht-cli`/`@jht-model`); `active_provider` mancante non
 *   diventa «anthropic».
 *
 * Gli handler sono quelli veri. Stubbati: `requireAuth`, `next/headers`, i
 * processi (`tmux` risponde con un copione) e la home, in una cartella
 * temporanea creata prima degli import perché i percorsi si leggono lì.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  home: require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "jht-t151-"),
  ) as string,
  tmux: "",
}));

vi.mock("@/lib/jht-paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jht-paths")>()),
  get JHT_HOME() {
    return state.home;
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAuth: async () => null,
}));

const NEXT_HEADERS = vi.hoisted(() =>
  require("node:module")
    .createRequire(
      require("node:path").resolve(__dirname, "../../../web/package.json"),
    )
    .resolve("next/headers"),
);
vi.mock(NEXT_HEADERS, () => ({
  headers: async () => new Headers({ host: "localhost:3001" }),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    execSync: (command: string) =>
      command.includes("@jht-cli") ? state.tmux : "",
    spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
  };
});

import { GET as readUsage } from "@/app/api/rate-limiter/route";
import { GET as readProviders } from "@/app/api/providers/route";

const ENV = process.env.JHT_LLM_PROVIDER;
const written: string[] = [];

function put(file: string, body: unknown) {
  const full = path.join(state.home, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body));
  written.push(full);
}

beforeEach(() => {
  delete process.env.JHT_LLM_PROVIDER;
  state.tmux = "";
});
afterEach(() => {
  for (const f of written.splice(0)) rmSync(f, { force: true });
});
afterAll(() => {
  if (ENV === undefined) delete process.env.JHT_LLM_PROVIDER;
  else process.env.JHT_LLM_PROVIDER = ENV;
  rmSync(state.home, { recursive: true, force: true });
});

const window = (total: number, roles: Record<string, number>) => ({
  since: "2026-10-24T18:00:00+00:00",
  total_kt: total,
  unattributed_kt: 0,
  roles: Object.fromEntries(
    Object.entries(roles).map(([role, kt]) => [
      role,
      {
        kt,
        share_pct: Math.round((kt / total) * 1000) / 10,
        agents: [`${role}-1`],
        events: 3,
      },
    ]),
  ),
});

const usage = (ageSec: number) => ({
  generated_at: new Date(Date.now() - ageSec * 1000).toISOString(),
  provider: "openai",
  windows: {
    "5h": window(100, { scout: 60, analista: 40 }),
    week: window(400, { scout: 300, analista: 100 }),
  },
  agents_1h: { "scout-1": 900, capitano: 0, "analista-1": 4000 },
});

describe("/api/rate-limiter: il consumo vero della sentinella, in sola lettura", () => {
  it("senza il file della sentinella dice «non so», non zero e non limiti inventati", async () => {
    const body = await (await readUsage()).json();
    expect(body.available).toBe(false);
    expect(body.limitsConfigurable).toBe(false);
    expect(body.windows).toEqual([]);
    expect(body.agents1h).toEqual([]);
    expect(body.ageSec).toBeNull();
  });

  it("rilegge le due finestre e l'ultima ora, dal più consumato", async () => {
    put("logs/role-usage.json", usage(60));
    const body = await (await readUsage()).json();
    expect(body.available).toBe(true);
    expect(body.fresh).toBe(true);
    expect(body.provider).toBe("openai");
    expect(body.windows.map((w: { id: string }) => w.id)).toEqual([
      "5h",
      "week",
    ]);
    expect(body.windows[0].totalKt).toBe(100);
    expect(body.windows[0].roles.map((r: { role: string }) => r.role)).toEqual([
      "scout",
      "analista",
    ]);
    expect(body.windows[0].roles[0]).toMatchObject({
      kt: 60,
      sharePct: 60,
      agents: 1,
    });
    expect(body.agents1h).toEqual([
      { agent: "analista-1", tokens: 4000 },
      { agent: "scout-1", tokens: 900 },
      { agent: "capitano", tokens: 0 },
    ]);
  });

  it("un dato di un'ora fa c'è ma non è fresco", async () => {
    put("logs/role-usage.json", usage(3600));
    const body = await (await readUsage()).json();
    expect(body.available).toBe(true);
    expect(body.fresh).toBe(false);
    expect(body.ageSec).toBeGreaterThanOrEqual(3600);
  });

  it("ignora la chiave rate_limiter della config: nessun limite inventato", async () => {
    put("jht.config.json", {
      rate_limiter: { global: { maxRequests: 7, windowMs: 1000 } },
    });
    put("logs/role-usage.json", usage(10));
    const text = JSON.stringify(await (await readUsage()).json());
    expect(text).not.toMatch(/maxRequests|windowMs|backoff|retry/i);
  });

  it("numeri o nomi che la sentinella non ha scritto bene diventano «non so» o spariscono", async () => {
    const raw = usage(10);
    (raw.windows["5h"].roles as Record<string, unknown>).scout = {
      kt: -5,
      share_pct: "tanto",
      agents: "x",
    };
    (raw.windows["5h"].roles as Record<string, unknown>)["../etc"] = { kt: 1 };
    put("logs/role-usage.json", raw);
    const body = await (await readUsage()).json();
    const scout = body.windows[0].roles.find(
      (r: { role: string }) => r.role === "scout",
    );
    expect(scout).toMatchObject({ kt: null, sharePct: null, agents: null });
    expect(
      body.windows[0].roles.map((r: { role: string }) => r.role),
    ).not.toContain("../etc");
  });

  it("un file illeggibile è come un file assente", async () => {
    put("logs/role-usage.json", "{non json");
    const body = await (await readUsage()).json();
    expect(body.available).toBe(false);
  });
});

describe("/api/providers: gli id veri e i modelli che girano", () => {
  it("elenca claude, codex, kimi (mai anthropic/openai) e non ha elenchi fissi di modelli", async () => {
    const body = await (await readProviders()).json();
    expect(body.providers.map((p: { id: string }) => p.id)).toEqual([
      "claude",
      "codex",
      "kimi",
    ]);
    for (const p of body.providers) {
      expect(p).not.toHaveProperty("models");
      expect(p).not.toHaveProperty("activeModel");
      expect(p.modelsInUse).toEqual([]);
    }
  });

  it("active_provider col nome vecchio (openai) segna codex come attivo", async () => {
    put("jht.config.json", {
      active_provider: "openai",
      providers: { openai: { subscription: {} } },
    });
    // La config si legge una volta per chiamata: nessuna cache fra una prova e l'altra.
    const body = await (await readProviders()).json();
    expect(body.activeProvider).toBe("codex");
    const codex = body.providers.find((p: { id: string }) => p.id === "codex");
    expect(codex).toMatchObject({
      active: true,
      available: true,
      keySource: "config",
    });
  });

  it("senza active_provider la pagina non ne inventa uno", async () => {
    const body = await (await readProviders()).json();
    expect(body.activeProvider).toBeNull();
    expect(body.providers.some((p: { active: boolean }) => p.active)).toBe(
      false,
    );
  });

  it("la config sotto il nome vecchio (anthropic) vale ancora per claude", async () => {
    put("jht.config.json", {
      active_provider: "claude",
      providers: { anthropic: { api_key: "x" } },
    });
    const body = await (await readProviders()).json();
    const claude = body.providers.find(
      (p: { id: string }) => p.id === "claude",
    );
    expect(claude).toMatchObject({
      active: true,
      available: true,
      keySource: "config",
    });
  });

  it("i modelli sono quelli delle sessioni del team accese, contati per agente", async () => {
    state.tmux = [
      "CAPITANO\tcodex\tgpt-5.6-sol",
      "SCOUT-1\tclaude\tsonnet",
      "SCOUT-2\tclaude\tsonnet",
      "SCOUT-3\tclaude\topus",
      "ALTRA-COSA\tcodex\tnon-del-team",
      "ANALISTA-1\tpi\tlocale",
      "CRITICO-1\tconstructor\tx",
    ].join("\n");
    const body = await (await readProviders()).json();
    const by = (id: string) =>
      body.providers.find((p: { id: string }) => p.id === id).modelsInUse;
    expect(by("claude")).toEqual([
      { model: "sonnet", agents: 2 },
      { model: "opus", agents: 1 },
    ]);
    expect(by("codex")).toEqual([{ model: "gpt-5.6-sol", agents: 1 }]);
    expect(by("kimi")).toEqual([]);
  });

  it("un nome di modello che non è un identificativo non arriva alla pagina", async () => {
    state.tmux = "SCOUT-1\tclaude\t<img src=x onerror=1>";
    const body = await (await readProviders()).json();
    const claude = body.providers.find(
      (p: { id: string }) => p.id === "claude",
    );
    expect(claude.modelsInUse).toEqual([{ model: null, agents: 1 }]);
    expect(JSON.stringify(body)).not.toContain("onerror");
  });
});
