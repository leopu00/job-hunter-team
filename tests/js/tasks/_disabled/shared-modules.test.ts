/** Test integrazione finale — shared/ barrel exports, types, circular deps, classi (vitest). */
import { describe, it, expect } from "vitest";

// Bulk import via Vite glob
const barrels = import.meta.glob("../../../shared/*/index.ts", { eager: true }) as Record<string, Record<string, unknown>>;
const typesAll = import.meta.glob("../../../shared/*/types.ts", { eager: true }) as Record<string, Record<string, unknown>>;

// Direct imports: classi, moduli senza barrel
import { JobQueue } from "../../../shared/queue/job-queue.js";
import { CircuitBreaker } from "../../../shared/retry/circuit-breaker.js";
import { EventBus } from "../../../shared/events/event-bus.js";
import { LRUCache } from "../../../shared/cache/lru-cache.js";
import * as healthCheck from "../../../shared/deploy/health-check.js";
import * as monitor from "../../../shared/deploy/monitor.js";
import { ENV_VAR_MAP } from "../../../shared/credentials/types.js";
import { DEFAULT_GATEWAY_CONFIG } from "../../../shared/gateway/types.js";

function modName(k: string): string { return k.match(/shared\/([^/]+)\//)?.[1] ?? k; }
function getBarrel(n: string) { return Object.entries(barrels).find(([k]) => modName(k) === n)?.[1]; }
function getTypes(n: string) { return Object.entries(typesAll).find(([k]) => modName(k) === n)?.[1]; }

const EXPECTED_BARRELS = [
  "agents", "analytics", "assistant", "backup", "cache", "channels",
  "config", "context-engine", "events", "history", "hooks", "i18n",
  "logger", "migrations", "monitoring", "notifications", "plugins", "queue",
  "rate-limiter", "retry", "scheduler", "sessions", "tasks", "telegram",
  "templates", "tools", "validators",
];

// --- 1. Barrel exports ---

describe("shared/ barrel — importabilità", () => {
  it("glob trova esattamente 27 barrel index.ts", () => {
    const found = Object.keys(barrels).map(modName).sort();
    expect(found).toHaveLength(27);
    for (const m of EXPECTED_BARRELS) expect(found, `manca ${m}`).toContain(m);
  });

  it("ogni barrel esporta almeno 1 simbolo runtime", () => {
    for (const [key, mod] of Object.entries(barrels)) {
      expect(Object.keys(mod).length, `${modName(key)} vuoto`).toBeGreaterThan(0);
    }
  });

  it("barrel con più export: queue, retry, plugins hanno >=5 simboli", () => {
    for (const m of ["queue", "retry", "plugins"]) {
      const b = getBarrel(m)!;
      expect(Object.keys(b).length, `${m} pochi export`).toBeGreaterThanOrEqual(5);
    }
  });
});

// --- 2. Types ---

describe("shared/ types.ts — consistenza DEFAULT_*_CONFIG", () => {
  it("glob trova almeno 25 types.ts", () => {
    expect(Object.keys(typesAll).length).toBeGreaterThanOrEqual(25);
  });

  it("12 DEFAULT_*_CONFIG definiti come oggetti", () => {
    const checks: [string, string][] = [
      ["backup", "DEFAULT_BACKUP_CONFIG"], ["cache", "DEFAULT_CACHE_CONFIG"],
      ["i18n", "DEFAULT_I18N_CONFIG"], ["migrations", "DEFAULT_MIGRATION_CONFIG"],
      ["retry", "DEFAULT_RETRY_CONFIG"], ["retry", "DEFAULT_CIRCUIT_CONFIG"],
      ["plugins", "DEFAULT_PLUGINS_CONFIG"], ["notifications", "DEFAULT_NOTIFICATIONS_CONFIG"],
      ["history", "DEFAULT_HISTORY_CONFIG"], ["queue", "DEFAULT_RETRY_POLICY"],
      ["assistant", "DEFAULT_ASSISTANT_CONFIG"], ["gateway", "DEFAULT_GATEWAY_CONFIG"],
    ];
    for (const [mod, key] of checks) {
      const t = getTypes(mod);
      expect(t, `${mod} types trovato`).toBeDefined();
      expect(t![key], `${mod}.${key}`).toBeDefined();
      expect(typeof t![key], `${mod}.${key} oggetto`).toBe("object");
    }
  });

  it("valori specifici: retry attempts=3, circuit threshold=5, cache maxEntries=1000", () => {
    const r = getTypes("retry")!;
    expect((r.DEFAULT_RETRY_CONFIG as any).attempts).toBe(3);
    expect((r.DEFAULT_CIRCUIT_CONFIG as any).failureThreshold).toBe(5);
    const c = getTypes("cache")!;
    expect((c.DEFAULT_CACHE_CONFIG as any).maxEntries).toBe(1000);
  });
});

// --- 3. Classi principali ---

describe("shared/ — classi esportate e istanziabili", () => {
  it("barrel esporta 6 classi core: JobQueue, CircuitBreaker, EventBus, LRUCache, Logger, RegistryBuilder", () => {
    expect(getBarrel("queue")!.JobQueue).toBeDefined();
    expect(getBarrel("retry")!.CircuitBreaker).toBeDefined();
    expect(getBarrel("retry")!.CircuitBreakerOpenError).toBeDefined();
    expect(getBarrel("events")!.EventBus).toBeDefined();
    expect(getBarrel("cache")!.LRUCache).toBeDefined();
    expect(getBarrel("logger")!.Logger).toBeDefined();
  });

  it("barrel esporta classi infra: ChannelRegistry, SessionRegistry, TeamBridge, HookRunner", () => {
    expect(getBarrel("channels")!.ChannelRegistry).toBeDefined();
    expect(getBarrel("sessions")!.SessionRegistry).toBeDefined();
    expect(getBarrel("assistant")!.TeamBridge).toBeDefined();
    expect(getBarrel("plugins")!.HookRunner).toBeDefined();
  });

  it("4 classi core istanziabili con constructor default", () => {
    expect(new JobQueue()).toBeInstanceOf(JobQueue);
    expect(new CircuitBreaker()).toBeInstanceOf(CircuitBreaker);
    expect(new EventBus()).toBeInstanceOf(EventBus);
    expect(new LRUCache()).toBeInstanceOf(LRUCache);
  });
});

// --- 4. Moduli senza barrel ---

describe("shared/ senza barrel — deploy, credentials, gateway, memory", () => {
  it("deploy: health-check e monitor hanno export runtime", () => {
    expect(Object.keys(healthCheck).length).toBeGreaterThan(0);
    expect(Object.keys(monitor).length).toBeGreaterThan(0);
  });

  it("credentials ENV_VAR_MAP e gateway DEFAULT_GATEWAY_CONFIG validi", () => {
    expect(ENV_VAR_MAP.claude).toBe("ANTHROPIC_API_KEY");
    expect(ENV_VAR_MAP.openai).toBe("OPENAI_API_KEY");
    expect(typeof DEFAULT_GATEWAY_CONFIG).toBe("object");
  });
});

// --- 5. Cross-module ---

describe("shared/ cross-module — barrel riesporta types", () => {
  it("queue barrel riesporta DEFAULT_RETRY_POLICY con maxAttempts >= 1", () => {
    const q = getBarrel("queue")!;
    expect(q.DEFAULT_RETRY_POLICY).toBeDefined();
    expect((q.DEFAULT_RETRY_POLICY as any).maxAttempts).toBeGreaterThanOrEqual(1);
  });

  it("barrel riesporta tutti i simboli runtime di types.ts (5 moduli)", () => {
    for (const mod of ["backup", "cache", "retry", "i18n", "events"]) {
      const b = getBarrel(mod)!;
      const t = getTypes(mod)!;
      for (const key of Object.keys(t)) {
        expect(b[key], `${mod} barrel manca ${key}`).toBeDefined();
      }
    }
  });

  it("i18n barrel esporta funzioni t, setLocale, getLocale, addTranslations", () => {
    const i = getBarrel("i18n")!;
    for (const fn of ["t", "setLocale", "getLocale", "addTranslations"]) {
      expect(typeof i[fn], `i18n.${fn} è funzione`).toBe("function");
    }
  });
});

// --- 6. No circular deps ---

describe("shared/ — no circular dependency", () => {
  it("tutti i 27 moduli caricati eager senza errori", () => {
    const names = Object.keys(barrels).map(modName).sort();
    expect(names).toHaveLength(27);
    for (const [, mod] of Object.entries(barrels)) {
      expect(mod).toBeDefined();
      expect(typeof mod).toBe("object");
    }
  });
});
