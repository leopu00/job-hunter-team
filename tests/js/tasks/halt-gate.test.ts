/**
 * Test — cli/src/lib/halt-gate.js (vitest)
 *
 * [HALT-FLAG-IGNORED-BY-THE-EVENT-DRIVEN-LOOP] — `.weekly-halt.flag` fermava
 * solo il loop a poll. Nel ramo event-driven compariva una volta sola, nella
 * cadenza lenta: le quattro corsie (sync, chat, ticket, emergency-stop) e il
 * battito chat a ~5 s non lo guardavano, quindi a freno tirato un UPDATE su
 * `team_state` faceva partire rendezvous e push — la spesa che il flag esiste
 * per fermare.
 *
 * Cosa proteggono questi test:
 *  1. una corsia costruita con `guardedLane` NON parte a freno tirato — ed è
 *     la proprietà che si eredita: il test sulla "quinta corsia" fallisce se
 *     qualcuno riporta il predicato dentro i singoli callback;
 *  2. il freno DICE di essere inserito. Il sintomo era un silenzio, e un
 *     silenzio si legge come «tutto tranquillo»: se sparisce l'annuncio,
 *     sparisce metà della correzione;
 *  3. il debounce preesistente resta, perché è nello stesso guscio.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHaltGate,
  guardedLane,
} from "../../../cli/src/lib/halt-gate.js";

/** Cancello con orologio e flag pilotati a mano. */
function harness(opts: { halted?: boolean; announceEveryMs?: number } = {}) {
  const state = { halted: opts.halted ?? false, clock: 0 };
  const halts: string[] = [];
  const resumes: number[] = [];
  const gate = createHaltGate({
    isHalted: () => state.halted,
    onHalt: (lane: string) => halts.push(lane),
    onResume: () => resumes.push(state.clock),
    announceEveryMs: opts.announceEveryMs ?? 60_000,
    now: () => state.clock,
  });
  return { state, halts, resumes, gate };
}

describe("createHaltGate — il predicato", () => {
  it("a freno libero non ferma e non parla", () => {
    const h = harness();
    expect(h.gate("sync")).toBe(false);
    expect(h.halts).toEqual([]);
    expect(h.resumes).toEqual([]);
  });

  it("a freno tirato ferma e lo annuncia", () => {
    const h = harness({ halted: true });
    expect(h.gate("sync/realtime")).toBe(true);
    expect(h.halts).toEqual(["sync/realtime"]);
  });

  it("non ripete l'annuncio a ogni battito della chat", () => {
    // La corsia chat chiama il cancello ogni ~5 s: senza limite riempirebbe
    // il log e nessuno leggerebbe più la riga che conta.
    const h = harness({ halted: true, announceEveryMs: 60_000 });
    for (let s = 0; s <= 55; s += 5) {
      h.state.clock = s * 1000;
      h.gate("chat/local");
    }
    expect(h.halts).toEqual(["chat/local"]);
  });

  it("ma torna a parlare dopo la finestra, così il freno non si dimentica", () => {
    const h = harness({ halted: true, announceEveryMs: 60_000 });
    h.gate("chat/local");
    h.state.clock = 60_000;
    h.gate("chat/local");
    expect(h.halts).toHaveLength(2);
  });

  it("annuncia il rilascio una volta sola", () => {
    const h = harness({ halted: true });
    h.gate("sync");
    h.state.halted = false;
    expect(h.gate("sync")).toBe(false);
    expect(h.resumes).toHaveLength(1);
    h.gate("sync");
    expect(h.resumes).toHaveLength(1);
  });

  it("non annuncia un rilascio se il freno non era mai stato inserito", () => {
    const h = harness();
    h.gate("sync");
    expect(h.resumes).toEqual([]);
  });

  it("dopo un rilascio, un nuovo halt riparla subito", () => {
    const h = harness({ halted: true, announceEveryMs: 60_000 });
    h.gate("sync");
    h.state.halted = false;
    h.gate("sync");
    h.state.halted = true;
    h.gate("sync");
    expect(h.halts).toHaveLength(2);
  });

  it("se leggere il flag solleva, considera il freno TIRATO", () => {
    // Non sapere se il freno è inserito non autorizza a spendere.
    const gate = createHaltGate({
      isHalted: () => {
        throw new Error("EIO");
      },
    });
    expect(gate("sync")).toBe(true);
  });
});

describe("guardedLane — il freno che si eredita", () => {
  const lane = (gate: (t?: string) => boolean, body: () => Promise<void>) =>
    guardedLane(gate, "sync", body);

  it("a freno libero la corsia parte", async () => {
    const h = harness();
    const body = vi.fn(async () => {});
    expect(await lane(h.gate, body)("realtime")).toBe(true);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("a freno tirato la corsia NON parte", async () => {
    const h = harness({ halted: true });
    const body = vi.fn(async () => {});
    expect(await lane(h.gate, body)("realtime")).toBe(false);
    expect(body).not.toHaveBeenCalled();
  });

  it("il difetto vero: un UPDATE su team_state non fa partire nessuna corsia", async () => {
    const h = harness({ halted: true });
    const spesa: string[] = [];
    const lanes = {
      sync: guardedLane(h.gate, "sync", async () => {
        spesa.push("rendezvous→push");
      }),
      chat: guardedLane(h.gate, "chat", async () => {
        spesa.push("chat-sync");
      }),
      ticket: guardedLane(h.gate, "ticket", async () => {
        spesa.push("ticket-sync");
      }),
      stop: guardedLane(h.gate, "emergency-stop", async () => {
        spesa.push("emergency-stop");
      }),
    };
    await lanes.sync("realtime");
    await lanes.chat("realtime");
    await lanes.stop("realtime");
    await lanes.ticket("realtime");
    await lanes.chat("local"); // il battito ogni ~5 s
    expect(spesa).toEqual([]);
    // …e non in silenzio: il sintomo era proprio l'assenza di questa riga.
    expect(h.halts.length).toBeGreaterThan(0);
  });

  it("una QUINTA corsia nasce frenata senza che nessuno se ne ricordi", async () => {
    // È la proprietà che il ticket chiede: se qualcuno riportasse il predicato
    // dentro i singoli callback, questo test cadrebbe.
    const h = harness({ halted: true });
    const body = vi.fn(async () => {});
    const nuova = guardedLane(h.gate, "corsia-futura", body);
    expect(await nuova("realtime")).toBe(false);
    expect(body).not.toHaveBeenCalled();
  });

  it("l'annuncio distingue la corsia e l'origine della sveglia", async () => {
    const h = harness({ halted: true, announceEveryMs: 0 });
    await guardedLane(h.gate, "chat", async () => {})("local");
    await guardedLane(h.gate, "sync", async () => {})("parachute");
    await guardedLane(h.gate, "ticket", async () => {})();
    expect(h.halts).toEqual(["chat/local", "sync/parachute", "ticket"]);
  });

  it("il debounce preesistente non si è perso nel guscio nuovo", async () => {
    const h = harness();
    let running = 0;
    let max = 0;
    const slow = guardedLane(h.gate, "sync", async () => {
      running += 1;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
    });
    await Promise.all([slow("a"), slow("b"), slow("c")]);
    expect(max).toBe(1);
  });

  it("un errore della corsia non la lascia bloccata per sempre", async () => {
    const h = harness();
    const errors: string[] = [];
    const boom = guardedLane(
      h.gate,
      "sync",
      async () => {
        throw new Error("rete giù");
      },
      (e: Error) => errors.push(e.message),
    );
    expect(await boom("realtime")).toBe(false);
    expect(await boom("realtime")).toBe(false);
    expect(errors).toEqual(["rete giù", "rete giù"]);
  });

  it("rilasciato il freno la corsia riparte", async () => {
    const h = harness({ halted: true });
    const body = vi.fn(async () => {});
    const run = lane(h.gate, body);
    await run("realtime");
    h.state.halted = false;
    expect(await run("realtime")).toBe(true);
    expect(body).toHaveBeenCalledTimes(1);
    expect(h.resumes).toHaveLength(1);
  });
});
