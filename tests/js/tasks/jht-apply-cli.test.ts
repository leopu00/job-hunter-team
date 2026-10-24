import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error — ESM JS del CLI senza tipi
import { requestAction, cancelAction } from "../../../cli/src/commands/apply.js";

// [JHT-CLOSER] Nel container `jht apply request` ha i permessi degli agenti: non
// autorizza piu' (l'autorizzazione che il CLOSER verifica sta nel broker, e la
// registrano solo i canali della persona). Mostra la posizione e chiede alla
// persona su Telegram. Il comando non contiene regole (le decide
// apply_gate.toggle_verdict via apply_request.py): questi test guardano
// l'unica cosa che vive qui, cioe' che da qui NON parta mai una scrittura,
// qualunque cosa risponda Telegram, e che un rifiuto della skill non venga
// mai scavalcato.

type Call = [string, string[]];

const POSITION = {
  ok: true,
  action: "show",
  reason: "toggle_allowed",
  id: 7,
  title: "Synthetic role",
  company: "Synthetic company",
  url: "https://jobs.ashbyhq.com/x/7",
  summary: "Synthetic role @ Synthetic company · jobs.ashbyhq.com",
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
  it("mostra la posizione e chiede su Telegram, senza scrivere", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run, calls } = fakeRun({ show: POSITION, request: { ok: true } });
    const askTelegram = vi.fn().mockReturnValue({ ok: true, status: "asked" });
    await requestAction("7", {}, { run, askTelegram });
    const printed = log.mock.calls.flat().join("\n");
    expect(printed).toContain("Synthetic role @ Synthetic company");
    expect(printed).toContain("Telegram");
    expect(askTelegram).toHaveBeenCalledTimes(1);
    expect(askTelegram.mock.calls[0][0]).toMatchObject({ id: 7, title: "Synthetic role", company: "Synthetic company" });
    // Solo `show`: niente `request`, e il comando non risulta mai autorizzato.
    expect(calls).toEqual([["apply_request.py", ["show", "7"]]]);
    expect(process.exitCode).toBeUndefined();
  });

  it("senza Telegram dice che da qui non autorizza, non scrive ed esce 1", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { run, calls } = fakeRun({ show: POSITION, request: { ok: true } });
    await requestAction("7", {}, { run, askTelegram: () => ({ ok: false }) });
    const printed = log.mock.calls.flat().join("\n");
    expect(printed).toContain("Not authorised from here");
    expect(printed).toContain("jht apply request 7");
    expect(actions(calls)).toEqual(["show"]);
    expect(process.exitCode).toBe(1);
  });

  it("--json: authorised e' sempre false, con o senza Telegram", async () => {
    for (const asked of [true, false]) {
      process.exitCode = undefined;
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const { run, calls } = fakeRun({ show: POSITION, request: { ok: true } });
      await requestAction("7", { json: true }, { run, askTelegram: () => ({ ok: asked }) });
      const out = JSON.parse(String(log.mock.calls.flat().pop()));
      expect(out).toMatchObject({
        ok: asked,
        action: "request",
        reason: asked ? "asked_on_telegram" : "authorise_from_your_channel",
        authorised: false,
        id: 7,
      });
      expect(actions(calls)).toEqual(["show"]);
      log.mockRestore();
    }
  });

  it("--yes non cambia niente: salta nessuna domanda e non scrive", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { run, calls } = fakeRun({ show: POSITION, request: { ok: true } });
    const askTelegram = vi.fn().mockReturnValue({ ok: true });
    await requestAction("7", { yes: true }, { run, askTelegram });
    expect(askTelegram).toHaveBeenCalledTimes(1);
    expect(actions(calls)).toEqual(["show"]);
  });

  it("un rifiuto della skill non viene scavalcato: niente domanda su Telegram", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = { ...POSITION, ok: false, reason: "position_not_ready", status: "review" };
    const { run, calls } = fakeRun({ show: refused, request: { ok: true } });
    const askTelegram = vi.fn().mockReturnValue({ ok: true });
    await requestAction("7", { yes: true }, { run, askTelegram });
    expect(askTelegram).not.toHaveBeenCalled();
    expect(actions(calls)).toEqual(["show"]);
    expect(process.exitCode).toBe(1);
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
