/**
 * Da un deploy cloud non si scrive mai sul box: le due route che lanciavano
 * processi con il solo `requireAuth`.
 *
 * - `POST /api/providers` aggiorna la CLI di un provider: `npm install -g` (o
 *   `uv tool install`) e, con `force`, `tmux kill-session` sulle sessioni
 *   attive;
 * - `POST /api/agents/[id]` avvia o ferma la sessione tmux di un agente.
 *
 * `requireAuth` accerta CHI SEI, non DOVE sei: una sessione Supabase valida
 * dal browser cloud le passava. Ora, come le altre scritture del web, hanno
 * anche `requireLocalWrite`, che su un deploy cloud rifiuta sempre (403
 * `read_only`), qualunque header porti la richiesta.
 *
 * Gli handler sono quelli veri. Stubbati: `requireAuth` (dice sempre sì: la
 * sessione valida è proprio il caso), `next/headers` (fuori da una richiesta
 * esplode) con un `Host` locale, i processi (`child_process`, `lib/shell`) che
 * si registrano invece di partire, e la home in una cartella temporanea.
 * Il controllo sul deploy locale prova che la stessa richiesta arriva davvero
 * al processo: il 403 del cloud viene dalla guardia, non da altro.
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  home: "",
  spawned: [] as string[],
  /** `tmux has-session` trova la sessione dell'agente. */
  sessionUp: false,
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

// `next` sta in `web/node_modules`: il mock va sul modulo che risolve
// `web/lib/auth.ts`, non su uno specifier che da qui non si trova.
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
  const record = (command: unknown, args?: unknown) => {
    state.spawned.push(
      [command, ...(Array.isArray(args) ? args : [])].join(" "),
    );
  };
  return {
    ...real,
    execSync: (command: string) => {
      record(command);
      if (command.startsWith("tmux has-session") && !state.sessionUp)
        throw new Error("no session");
      return "";
    },
    spawnSync: (command: string, args: string[]) => {
      record(command, args);
      return { status: 0, stdout: "", stderr: "" };
    },
  };
});

vi.mock("@/lib/shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shell")>()),
  runBash: async (command: string) => {
    state.spawned.push(command);
    return { stdout: "", stderr: "" };
  },
  runScript: async (script: string, ...args: string[]) => {
    state.spawned.push([script, ...args].join(" "));
    return { stdout: "", stderr: "" };
  },
}));

import { POST as updateProvider } from "@/app/api/providers/route";
import { POST as commandAgent } from "@/app/api/agents/[id]/route";

const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;
const temporary = mkdtempSync(path.join(tmpdir(), "jht-box-writes-"));

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:3001" },
    body: JSON.stringify(body),
  });
}

const CASES = [
  {
    name: "POST /api/providers (CLI update)",
    call: () =>
      updateProvider(
        post("http://localhost:3001/api/providers", {
          providerId: "openai",
          force: true,
        }),
      ),
    sessionUp: false,
    process: /^npm install -g @openai\/codex/,
  },
  {
    name: "POST /api/agents/[id] (stop)",
    call: () =>
      commandAgent(
        post("http://localhost:3001/api/agents/scout", { action: "stop" }),
        {
          params: Promise.resolve({ id: "scout" }),
        },
      ),
    sessionUp: true,
    process: /^tmux kill-session -t "SCOUT-1"/,
  },
  {
    name: "POST /api/agents/[id] (start)",
    call: () =>
      commandAgent(
        post("http://localhost:3001/api/agents/scout", { action: "start" }),
        {
          params: Promise.resolve({ id: "scout" }),
        },
      ),
    sessionUp: false,
    process: /start-agent\.sh scout 1$/,
  },
];

beforeEach(() => {
  state.home = temporary;
  state.spawned = [];
});

afterEach(() => {
  if (ORIGINAL_DEPLOY === undefined) delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
  else process.env.NEXT_PUBLIC_JHT_DEPLOY = ORIGINAL_DEPLOY;
});

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe("box writes from a cloud deploy", () => {
  it.each(CASES)(
    "$name: an authenticated request is refused and nothing runs",
    async ({ call, sessionUp }) => {
      process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
      state.sessionUp = sessionUp;
      const response = await call();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "read_only" });
      expect(state.spawned).toEqual([]);
    },
  );

  it.each(CASES)(
    "$name: the same request on the box reaches the process",
    async ({ call, sessionUp, process: expected }) => {
      process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
      state.sessionUp = sessionUp;
      const response = await call();
      expect(response.status).not.toBe(403);
      expect(
        state.spawned.some((command) => expected.test(command)),
        state.spawned.join("\n"),
      ).toBe(true);
    },
  );
});
