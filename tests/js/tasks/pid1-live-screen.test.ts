import { describe, expect, it } from "vitest";

import {
  liveScreenDecision,
  liveScreenShouldRespawn,
} from "../../../cli/src/commands/pid1.js";

describe("pid1 live screen (CLOSER)", () => {
  it("accende lo schermo di default: è dove apply_flow --headful disegna", () => {
    const decision = liveScreenDecision({ env: {}, scriptExists: () => true, binaryOnPath: () => true });
    expect(decision).toEqual({ start: true, reason: "enabled" });
  });

  it("JHT_LIVE_SCREEN_EXTERNAL=1: lo schermo e' un contenitore a parte, pid1 non ne accende uno suo", () => {
    for (const value of ["1", " 1 "]) {
      const decision = liveScreenDecision({
        env: { JHT_LIVE_SCREEN_EXTERNAL: value },
        scriptExists: () => true,
        binaryOnPath: () => true,
      });
      expect(decision.start).toBe(false);
      expect(decision.reason).toBe("JHT_LIVE_SCREEN_EXTERNAL=1");
    }
    for (const value of ["0", "", "yes"]) {
      expect(
        liveScreenDecision({ env: { JHT_LIVE_SCREEN_EXTERNAL: value }, scriptExists: () => true, binaryOnPath: () => true }).start,
      ).toBe(true);
    }
  });

  it("JHT_LIVE_SCREEN=0 lo spegne, anche con spazi intorno", () => {
    for (const value of ["0", " 0 "]) {
      const decision = liveScreenDecision({
        env: { JHT_LIVE_SCREEN: value },
        scriptExists: () => true,
        binaryOnPath: () => true,
      });
      expect(decision.start).toBe(false);
      expect(decision.reason).toBe("JHT_LIVE_SCREEN=0");
    }
    // Solo "0" spegne: un valore qualunque non deve togliere lo schermo al CLOSER.
    expect(
      liveScreenDecision({ env: { JHT_LIVE_SCREEN: "1" }, scriptExists: () => true, binaryOnPath: () => true }).start,
    ).toBe(true);
  });

  it("immagine nucleo: senza Xvfb/x11vnc/websockify salta in silenzio, con tutti e tre parte", () => {
    const only = (present: string[]) => (bin: string) => present.includes(bin);
    const none = liveScreenDecision({ env: {}, scriptExists: () => true, binaryOnPath: only([]) });
    expect(none.start).toBe(false);
    expect(none.reason).toContain("not installed yet");
    expect(none.reason).toContain("Xvfb");
    const partial = liveScreenDecision({
      env: {},
      scriptExists: () => true,
      binaryOnPath: only(["Xvfb", "x11vnc"]),
    });
    expect(partial.start).toBe(false);
    expect(partial.reason).toContain("websockify");
    const all = liveScreenDecision({
      env: {},
      scriptExists: () => true,
      binaryOnPath: only(["Xvfb", "x11vnc", "websockify"]),
    });
    expect(all).toEqual({ start: true, reason: "enabled" });
  });

  it("un'immagine senza lo script non prova ad avviarlo", () => {
    const decision = liveScreenDecision({ env: {}, scriptExists: () => false });
    expect(decision.start).toBe(false);
    expect(decision.reason).toContain("live-screen.sh not found");
  });

  it("non riavvia in loop un errore di configurazione o un'immagine senza binari", () => {
    expect(liveScreenShouldRespawn(2)).toBe(false);
    expect(liveScreenShouldRespawn(3)).toBe(false);
    // Crash di un componente, display occupato, Xvfb lento: si riprova.
    for (const code of [1, 4, 6, null]) {
      expect(liveScreenShouldRespawn(code)).toBe(true);
    }
  });
});
