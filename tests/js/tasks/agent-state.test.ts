import { describe, expect, it } from "vitest";
import {
  AGENT_STATES,
  describeAgentState,
  isAgentState,
  isAnomalous,
  isKnownReason,
} from "@/lib/agent-state";
import CATALOG from "../../../shared/agent-state/catalog.json";

const LANGS = ["it", "en", "de", "es", "fr", "hu", "pt"];
const NOW = Date.parse("2026-10-18T12:00:00Z");

describe("the line of an agent's state (shared/agent-state/catalog.json)", () => {
  it("knows the states and the reasons of the catalog and nothing else", () => {
    expect([...AGENT_STATES].sort()).toEqual(Object.keys(CATALOG.states).sort());
    for (const reason of Object.keys(CATALOG.reasons)) expect(isKnownReason(reason)).toBe(true);
    expect(isKnownReason("colpa_del_gatto")).toBe(false);
    expect(isKnownReason("toString")).toBe(false);
    expect(isAgentState("lavora")).toBe(true);
    expect(isAgentState("working")).toBe(false);
  });

  it("says icon, word, reason and when, in each of the 7 languages", () => {
    for (const lang of LANGS) {
      const blocked = describeAgentState({ state: "bloccato", reason: "limite_5h", until: NOW + 3_600_000, since: NOW - 60_000 }, lang, NOW);
      expect(blocked.line, lang).toContain(CATALOG.states.bloccato.text[lang as "it"]);
      expect(blocked.line, lang).toMatch(/^⏸ /);
      expect(blocked.reason, lang).not.toContain("{");
      expect(blocked.tone).toBe("amber");
      expect(blocked.when, lang).toBeNull(); // the reason already carries the time it lifts
    }
    const it = describeAgentState({ state: "bloccato", reason: "limite_5h", until: Date.parse("2026-10-18T14:05:00Z") }, "it", NOW);
    expect(it.reason).toMatch(/^limite di 5 ore · riprova \d{1,2}[:.]\d{2}$/);
  });

  it("a limit with no time to give says only what it is", () => {
    const line = describeAgentState({ state: "bloccato", reason: "limite_settimanale" }, "en", NOW);
    expect(line.reason).toBe("weekly limit");
    expect(line.line).toBe("⏸ blocked · weekly limit");
  });

  it("a silent turn says for how long, a pacing pause how long is left", () => {
    const silent = describeAgentState({ state: "sconosciuto", reason: "turno_silenzioso", since: NOW - 12 * 60_000 }, "en", NOW);
    expect(silent.reason).toMatch(/no signal for .*12/);
    expect(silent.tone).toBe("grey");
    const pause = describeAgentState({ state: "bloccato", reason: "pausa_pacing", until: NOW + 95_000 }, "en", NOW);
    expect(pause.reason).toMatch(/paused for pacing · .*2/);
  });

  it("a state with no reason of its own says how long ago it began", () => {
    const waits = describeAgentState({ state: "aspetta_umano", since: NOW - 5 * 60_000 }, "en", NOW);
    expect(waits.tone).toBe("blue");
    expect(waits.when).toMatch(/5/);
    expect(waits.line.startsWith("✋ waiting for you · ")).toBe(true);
    const never = describeAgentState({ state: "avviato_mai_partito", since: NOW - 10 * 60_000 }, "it", NOW);
    expect(never.tone).toBe("grey");
    expect(never.line).toContain("avviato, nessun turno");
  });

  it("a reason the catalog does not have is left out, never printed", () => {
    const line = describeAgentState({ state: "bloccato", reason: "Rate limit reached, call 555-0100" }, "en", NOW);
    expect(line.reason).toBeNull();
    expect(line.line).toBe("⏸ blocked");
  });

  it("only a login that needs the person is red", () => {
    expect(describeAgentState({ state: "bloccato", reason: "accesso_scaduto" }, "en", NOW).tone).toBe("red");
    for (const s of AGENT_STATES) expect(describeAgentState({ state: s }, "en", NOW).tone).not.toBe("red");
  });

  it("an unknown language falls back to English", () => {
    expect(describeAgentState({ state: "spento" }, "ja", NOW).word).toBe("off");
  });

  it("the anomalous states are the ones a person is told about", () => {
    expect(AGENT_STATES.filter(isAnomalous).sort()).toEqual(["aspetta_umano", "avviato_mai_partito", "bloccato", "sconosciuto"]);
  });
});
