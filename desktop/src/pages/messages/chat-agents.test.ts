import { describe, expect, it } from "vitest";
import { chatIdOfSession, conversationsOf, isChatAgentId, roleOfChatId, sessionOfChatId } from "./chat-agents";

const ROLES = { capitano: "Capitano", assistente: "Assistente", mentor: "Mentor", scout: "Scout", analista: "Analista", scorer: "Scorer", scrittore: "Scrittore", critico: "Critico" };
const up = (...sessions: string[]) => sessions.map((session) => ({ session, up: true }));

describe("the ids of the chat", () => {
  it("are the eight fixed ones and the instances of a numbered role, and nothing near them", () => {
    for (const ok of ["capitano", "scout", "scout-1", "analista-2", "scorer-4", "scrittore-9999"]) expect(isChatAgentId(ok), ok).toBe(true);
    for (const bad of ["", "scout-0", "scout-01", "scout-10000", "scout-", "scout-x", "Scout-2", "critico-2", "capitano-1", "scout-2\n", "../scout-2", "scout_2", "dottore", null, undefined]) {
      expect(isChatAgentId(bad as string), String(bad)).toBe(false);
    }
  });

  it("go to the session and back: the first instance keeps its bare id", () => {
    expect(chatIdOfSession("SCOUT-1")).toBe("scout");
    expect(chatIdOfSession("SCOUT-2")).toBe("scout-2");
    expect(chatIdOfSession("CAPITANO")).toBe("capitano");
    expect(sessionOfChatId("scout")).toBe("SCOUT-1");
    expect(sessionOfChatId("scrittore-12")).toBe("SCRITTORE-12");
    expect(sessionOfChatId("critico")).toBe("CRITICO");
    expect(sessionOfChatId("nobody")).toBeNull();
    expect(roleOfChatId("analista-2")).toEqual({ role: "analista", instance: 2 });
    expect(roleOfChatId("analista")).toEqual({ role: "analista", instance: 1 });
    expect(roleOfChatId("capitano")).toEqual({ role: "capitano", instance: null });
  });
});

describe("the list of conversations", () => {
  it("is the eight roles when the team has not said which sessions it has", () => {
    const list = conversationsOf(null, ROLES);
    expect(list.map((c) => c.id)).toEqual(["capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico"]);
    expect(list.map((c) => c.label)).toEqual(["Capitano", "Assistente", "Mentor", "Scout", "Analista", "Scorer", "Scrittore", "Critico"]);
  });

  it("has one conversation per instance that is up, numbered only where a role has several", () => {
    const list = conversationsOf(up("CAPITANO", "SCOUT-1", "ANALISTA-1", "ANALISTA-2", "ANALISTA-10", "SCORER-3"), ROLES);
    expect(list.filter((c) => c.session.startsWith("ANALISTA")).map((c) => [c.id, c.label])).toEqual([
      ["analista", "Analista 1"],
      ["analista-2", "Analista 2"],
      ["analista-10", "Analista 10"],
    ]);
    expect(list.find((c) => c.session === "SCOUT-1")).toMatchObject({ id: "scout", label: "Scout", up: true });
    // the only instance up is the third: it is named by its number, and the first is not listed
    expect(list.find((c) => c.session === "SCORER-3")).toMatchObject({ id: "scorer-3", label: "Scorer", up: true });
    expect(list.some((c) => c.session === "SCORER-1")).toBe(false);
  });

  it("keeps a role with no instance up, off, so its history can be read; the roles with one session always", () => {
    const list = conversationsOf(up("CAPITANO"), ROLES);
    expect(list.find((c) => c.id === "scout")).toMatchObject({ session: "SCOUT-1", up: false });
    expect(list.find((c) => c.id === "capitano")?.up).toBe(true);
    expect(list.find((c) => c.id === "mentor")?.up).toBe(false);
  });

  it("does not list a session that is off, or a name that is not of the grammar", () => {
    const list = conversationsOf([{ session: "SCOUT-2", up: false }, { session: "SCOUT-0", up: true }, { session: "DOTTORE", up: true }], ROLES);
    expect(list.map((c) => c.id)).toEqual(["capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico"]);
  });
});
