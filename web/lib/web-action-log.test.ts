import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import {
  actionTitle,
  cleanLogText,
  isKnownAction,
  parseWebActionRow,
  parseWebActionRows,
  readWebActionLog,
  statusLabel,
  statusTone,
  WEB_ACTION_CODES,
  WEB_ACTION_LOG_COLUMNS,
  WEB_ACTION_LOG_LIMIT,
  WEB_ACTION_STATUSES,
  type WebActionLogClient,
  type WebActionRow,
} from "./web-action-log";
import { WEB_ACTION_LOG_TEXT } from "./web-action-log.i18n";

const raw = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  action: "team_restart",
  target: null,
  summary: "Restart of the team",
  level: "L2",
  status: "done",
  created_at: "2026-10-22T10:00:00Z",
  confirmed_at: "2026-10-22T10:00:20Z",
  result: null,
  ...over,
});

describe("one row of the log", () => {
  it("is read field by field, with the times in ISO", () => {
    expect(parseWebActionRow(raw())).toEqual({
      id: "a1",
      action: "team_restart",
      target: null,
      summary: "Restart of the team",
      level: "L2",
      status: "done",
      createdAt: "2026-10-22T10:00:00.000Z",
      confirmedAt: "2026-10-22T10:00:20.000Z",
      result: null,
    });
  });

  it.each([
    ["no id", { id: "" }],
    ["no action", { action: "  " }],
    ["no time", { created_at: null }],
    ["a time that is not one", { created_at: "yesterday-ish" }],
  ])("is dropped with %s: it cannot be placed in a list", (_, over) => {
    expect(parseWebActionRow(raw(over))).toBeNull();
  });

  it("is dropped when it is not an object", () => {
    for (const value of [null, undefined, 7, "x", []]) expect(parseWebActionRow(value)).toBeNull();
  });

  it("keeps a state and an action it does not know, as unknown, never as another one", () => {
    const row = parseWebActionRow(raw({ status: "teleported", action: "make_coffee" }))!;
    expect(row.status).toBeNull();
    expect(row.action).toBe("make_coffee");
    expect(isKnownAction(row.action)).toBe(false);
  });

  it("takes the level as L1/L2/L3 or as 1/2/3, and nothing else", () => {
    expect(parseWebActionRow(raw({ level: 3 }))!.level).toBe("L3");
    expect(parseWebActionRow(raw({ level: "l1" }))!.level).toBe("L1");
    expect(parseWebActionRow(raw({ level: "L9" }))!.level).toBeNull();
    expect(parseWebActionRow(raw({ level: null }))!.level).toBeNull();
  });

  it("takes a numeric id", () => {
    expect(parseWebActionRow(raw({ id: 42 }))!.id).toBe("42");
  });
});

describe("the text of a row is cleaned before anyone sees it", () => {
  it("keeps markup as plain text (the screen escapes it) and clips the summary at 200", () => {
    const row = parseWebActionRow(raw({ summary: `<img src=x onerror=alert(1)>${"a".repeat(300)}` }))!;
    expect(row.summary.startsWith("<img src=x onerror=alert(1)>")).toBe(true);
    expect(Array.from(row.summary)).toHaveLength(200);
    expect(row.summary.endsWith("…")).toBe(true);
  });

  it("turns controls, line separators, zero-width and direction marks into plain spaces", () => {
    const hidden = [0x0, 0x7, 0xa, 0x85, 0x200b, 0x200e, 0x2028, 0x202e, 0x2066, 0xfeff].map((code) => String.fromCodePoint(code));
    expect(cleanLogText(`a${hidden.join("")}b`, 50)).toBe("a b");
    expect(cleanLogText("  two\n\nlines\there  ", 50)).toBe("two lines here");
  });

  it("clips by characters, not by code units: an emoji is not cut in half", () => {
    const text = "😀".repeat(10);
    const out = cleanLogText(text, 5);
    expect(Array.from(out)).toHaveLength(5);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("is empty for anything that is not text", () => {
    for (const value of [null, undefined, 5, {}, ["a"]]) expect(cleanLogText(value, 10)).toBe("");
  });

  it("clips the target and the result too", () => {
    const row = parseWebActionRow(raw({ target: "t".repeat(200), result: "r".repeat(500) }))!;
    expect(Array.from(row.target!)).toHaveLength(64);
    expect(Array.from(row.result!)).toHaveLength(200);
  });
});

describe("the rows of a read", () => {
  it("come newest first, the ones that cannot be placed dropped", () => {
    const rows = parseWebActionRows([
      raw({ id: "old", created_at: "2026-10-20T10:00:00Z" }),
      { nonsense: true },
      raw({ id: "new", created_at: "2026-10-22T10:00:00Z" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("are none when the answer is not a list", () => {
    expect(parseWebActionRows(null)).toEqual([]);
    expect(parseWebActionRows({ rows: [] })).toEqual([]);
  });
});

function fakeClient(answer: { data?: unknown; error?: { code?: string; message?: string } | null } | Error) {
  const calls: unknown[][] = [];
  const client: WebActionLogClient = {
    from(table: string) {
      calls.push(["from", table]);
      return {
        select(columns: string) {
          calls.push(["select", columns]);
          return {
            order(column: string, options: unknown) {
              calls.push(["order", column, options]);
              return {
                limit(count: number) {
                  calls.push(["limit", count]);
                  if (answer instanceof Error) return Promise.reject(answer);
                  return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe("reading the log", () => {
  it("asks for the person's rows only by their table, newest first, a hundred at most, and no owner or session column", async () => {
    const { client, calls } = fakeClient({ data: [raw()] });
    const read = await readWebActionLog(client);
    expect(read.ok && read.rows).toHaveLength(1);
    expect(calls).toEqual([
      ["from", "web_action_log"],
      ["select", WEB_ACTION_LOG_COLUMNS],
      ["order", "created_at", { ascending: false }],
      ["limit", WEB_ACTION_LOG_LIMIT],
    ]);
    expect(WEB_ACTION_LOG_LIMIT).toBe(100);
    expect(WEB_ACTION_LOG_COLUMNS).not.toMatch(/user_id|session_id/);
  });

  it.each([
    ["42P01", "not_active"],
    ["PGRST205", "not_active"],
    ["42501", "signed_out"],
    ["PGRST301", "signed_out"],
    ["57014", "unavailable"],
    [undefined, "unavailable"],
  ])("says why it could not: the code %s is %s", async (code, reason) => {
    const { client } = fakeClient({ error: { code, message: "relation web_action_log SECRET detail" } });
    expect(await readWebActionLog(client)).toEqual({ ok: false, reason });
  });

  it("answers with a reason, not an exception, when the network breaks", async () => {
    const { client } = fakeClient(new Error("boom"));
    expect(await readWebActionLog(client)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("the words", () => {
  const row = (over: Partial<WebActionRow> = {}) => parseWebActionRow(raw(over as Record<string, unknown>))!;

  it("name a known action in the person's language and an unknown one by its code", () => {
    expect(actionTitle(row({ action: "apply_request" } as never), "it")).toBe("Candidatura autorizzata");
    expect(actionTitle(row({ action: "make_coffee" } as never), "en")).toBe("Other action (make_coffee)");
  });

  it("name a state, or say it is not known", () => {
    expect(statusLabel(row(), "it")).toBe("Eseguita");
    expect(statusLabel(row({ status: "nope" } as never), "it")).toBe("Stato non noto");
  });

  it("give each state a tone, and an unknown one none", () => {
    expect(statusTone("done")).toBe("good");
    expect(statusTone("error")).toBe("bad");
    expect(statusTone("queued")).toBe("wait");
    expect(statusTone("awaiting_confirm")).toBe("wait");
    expect(statusTone("cancelled")).toBe("neutral");
    expect(statusTone(null)).toBe("neutral");
  });

  it.each(locales)("%s: every action, state and level has its word, and the slots are there", (locale) => {
    const t = WEB_ACTION_LOG_TEXT[locale];
    for (const code of WEB_ACTION_CODES) expect(t.action[code].trim(), code).not.toBe("");
    for (const status of WEB_ACTION_STATUSES) expect(t.status[status].trim(), status).not.toBe("");
    for (const level of ["L1", "L2", "L3"] as const) {
      expect(t.level[level].trim()).not.toBe("");
      expect(t.levelHelp[level].trim()).not.toBe("");
    }
    expect(new Set(WEB_ACTION_CODES.map((code) => t.action[code])).size).toBe(WEB_ACTION_CODES.length);
    expect(t.unknownAction).toContain("{code}");
    expect(t.limitNote).toContain("{n}");
    expect(t.confirmed).toContain("{time}");
  });

  it.each(locales.filter((locale) => locale !== "it"))("%s: is a translation, not the Italian text left in", (locale) => {
    const it = WEB_ACTION_LOG_TEXT.it;
    const t = WEB_ACTION_LOG_TEXT[locale];
    expect(t.title).not.toBe(it.title);
    expect(t.intro).not.toBe(it.intro);
    expect(t.empty).not.toBe(it.empty);
    expect(t.status.done).not.toBe(it.status.done);
  });
});
