import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — ESM JS del CLI senza tipi
import { requestAction, cancelAction } from "../../../cli/src/commands/apply.js";

// [JHT-CLOSER] `jht apply request` accende il flag che È l'invio. Il comando
// non contiene regole (le decide apply_gate.toggle_verdict via
// apply_request.py): questi test guardano l'unica cosa che vive qui, cioè che
// la scrittura NON parta mai senza che l'utente abbia visto la posizione e
// confermato — e che un rifiuto della skill non venga mai scavalcato.

type Call = [string, string[]];

const POSITION = {
  ok: true,
  action: "show",
  reason: "toggle_allowed",
  id: 7,
  title: "Synthetic role",
  company: "Synthetic company",
  url: "https://jobs.ashbyhq.com/x/7",
  status: "ready",
};

function fakeRun(responses: Record<string, unknown>) {
  const calls: Call[] = [];
  const run = (skill: string, args: string[]) => {
    calls.push([skill, args]);
    const out = responses[args[0]];
    const ok = (out as { ok?: boolean })?.ok;
    return { code: ok ? 0 : 1, stdout: JSON.stringify(out) + "\n", stderr: "" };
  };
  return { run, calls };
}

const actions = (calls: Call[]) => calls.map(([, args]) => args[0]);

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("jht apply request", () => {
  it("fuori da un terminale, senza --yes, rifiuta e non scrive", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run, calls } = fakeRun({ show: POSITION, request: { ok: true } });
    await requestAction("7", {}, { run, interactive: false });
    expect(actions(calls)).toEqual(["show"]);
    expect(process.exitCode).toBe(1);
  });

  it("mostra titolo, azienda e URL prima di chiedere, e senza un sì non scrive", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run, calls } = fakeRun({ show: POSITION, request: { ok: true } });
    const confirm = vi.fn().mockResolvedValue(false);
    await requestAction("7", {}, { run, interactive: true, confirm });
    const printed = log.mock.calls.flat().join("\n");
    expect(printed).toContain("Synthetic role");
    expect(printed).toContain("Synthetic company");
    expect(printed).toContain("https://jobs.ashbyhq.com/x/7");
    expect(printed).toMatch(/SUBMIT/);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(actions(calls)).toEqual(["show"]);
  });

  it("con la conferma scrive, passando l'id esatto", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { run, calls } = fakeRun({
      show: POSITION,
      request: { ok: true, id: 7, queue: { ready: true, held: [] } },
    });
    await requestAction("7", {}, { run, interactive: true, confirm: async () => true });
    expect(calls).toEqual([
      ["apply_request.py", ["show", "7"]],
      ["apply_request.py", ["request", "7"]],
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it("--yes salta la domanda ma non il controllo della skill", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = { ...POSITION, ok: false, reason: "position_not_ready", status: "review" };
    const { run, calls } = fakeRun({ show: refused, request: { ok: true } });
    await requestAction("7", { yes: true }, { run, interactive: false });
    expect(actions(calls)).toEqual(["show"]);
    expect(process.exitCode).toBe(1);
  });

  it("dice quando il flag è scritto ma la coda non partirà", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run } = fakeRun({
      show: POSITION,
      request: { ok: true, id: 7, queue: { ready: false, reason: "consent_disabled", detail: "off", held: [] } },
    });
    await requestAction("7", { yes: true }, { run, interactive: false });
    expect(log.mock.calls.flat().join("\n")).toContain("consent_disabled");
  });
});

describe("jht apply cancel", () => {
  it("un rifiuto (già inviata) esce 1", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run } = fakeRun({ cancel: { ok: false, reason: "already_submitted" } });
    cancelAction("3", {}, { run });
    expect(process.exitCode).toBe(1);
  });
});
