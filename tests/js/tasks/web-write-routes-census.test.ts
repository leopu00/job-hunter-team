import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACTION_GATES,
  censusOf,
  writeHandlers,
  WRITE_GUARDS,
  type WriteMethod,
} from "../helpers/write-route-census";

// JHT-T46 family: the website stays read-only, the writes are the desktop's. Every route of web/app/api
// that exports POST, PUT, PATCH or DELETE either starts with a write guard (requireLocalWrite,
// requireDesktopWrite, requireLocalMachine, requireLocalSecretAccess, blockIfRemote: before the body, the
// database, a process or a file is touched), or is listed below with the reason it may stay open. A new
// route without a guard, or a new write method on a listed route, is red until someone decides.
const API = resolve(__dirname, "../../../web/app/api");

/** The write handlers that keep their guard (or their requestAction gate) in a local helper. */
const HELPERS: Record<string, Partial<Record<WriteMethod, string>>> = {
  // both handlers delegate to one helper, which opens with the gate
  "positions/[legacyId]/apply-request": {
    POST: "handleToggle",
    DELETE: "handleToggle",
  },
};

type Level = "L1" | "L2" | "L3";

type Kind =
  | "device-channel" // the box, authenticated with its sync token, not a website session
  | "device-pairing" // the pairing of a box with an account
  | "own-account" // the signed-in user acting on their own account
  | "request-lane" // an async request that travels to the box (declared in the doc of requireLocalWrite)
  | "public" // no session by design (the landing); carries nothing personal or no system state
  | "cloud-refuses" // refused on the cloud deploy by another mechanism
  | "disabled" // off unless the operator turns it on
  | "not-found"; // answers 404 for every method

interface Exception {
  methods: WriteMethod[];
  kind: Kind;
  reason: string;
  /**
   * Required for a request-lane route: L1 notes something of the user's own, no effect outside; L2
   * commands the team; L3 acts toward the outside (an application, an email).
   */
  level?: Level;
  /**
   * L2 and L3 go through the action library (`requestAction`, which checks the recent session, the
   * confirmation and the limits in the database): `gate: "requestAction"` is checked to come before any
   * write; `todo` names the phase that adds it, and the route is open until then.
   */
  gate?: "requestAction";
  todo?: string;
}

const EXCEPTIONS: Record<string, Exception> = {
  "[...catchall]": {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    kind: "not-found",
    reason: "answers 404 to every method and writes nothing",
  },
  "account/delete": {
    methods: ["POST"],
    kind: "own-account",
    reason:
      "deletes the signed-in user's own account, after the exact email is typed; never another user's",
  },
  "ai-assistant": {
    methods: ["POST"],
    kind: "disabled",
    reason: "off by default (404) unless the deploy turns the assistant on",
  },
  "cloud-sync/chat": {
    methods: ["POST"],
    kind: "device-channel",
    reason:
      "the box's chat channel, authenticated with its sync token like the push (see the note in the file)",
  },
  "cloud-sync/device-confirm": {
    methods: ["POST"],
    kind: "device-pairing",
    reason:
      "the signed-in user approves the code of a box they are pairing to their own account",
  },
  "cloud-sync/device-init": {
    methods: ["POST"],
    kind: "device-pairing",
    reason: "a box asks for a pairing code; it holds no account yet",
  },
  "cloud-sync/device-poll": {
    methods: ["POST"],
    kind: "device-pairing",
    reason: "the box asks whether its pairing code was approved",
  },
  "cloud-sync/device-register": {
    methods: ["POST"],
    kind: "device-pairing",
    reason: "the box registers after the user approved its code",
  },
  "cloud-sync/file-bridge/[id]": {
    methods: ["PATCH"],
    kind: "device-channel",
    reason: "the box updates a file of the bridge, with its sync token",
  },
  "cloud-sync/file-bridge/purge": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box purges its own bridge files, with its sync token",
  },
  "cloud-sync/file-index": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box publishes its file index, with its sync token",
  },
  "cloud-sync/push": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box pushes its state to the cloud, with its sync token",
  },
  "cloud-sync/revoke": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box revokes its own token",
  },
  "cloud-sync/team-commands/[id]": {
    methods: ["PATCH"],
    kind: "device-channel",
    reason:
      "the box reports the outcome of a command it ran, with its sync token",
  },
  "cloud-sync/team-directives": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box syncs the standing orders it holds, with its sync token",
  },
  "cloud-sync/tickets": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box pushes its tickets, with its sync token",
  },
  "cloud-sync/tokens": {
    methods: ["POST", "DELETE"],
    kind: "own-account",
    reason:
      "the signed-in user mints and revokes the sync tokens of their own account",
  },
  "csp-report": {
    methods: ["POST"],
    kind: "public",
    reason:
      "where the browser reports what the strict CSP would block (Report-Only); no cookie, writes nothing but one sanitised log line, rate limited",
  },
  demo: {
    methods: ["POST", "DELETE"],
    kind: "public",
    reason:
      "turns the static demo dataset on and off with a cookie of the caller; cloud only, writes no data",
  },
  feedback: {
    methods: ["POST"],
    kind: "public",
    reason: "the anonymous problem report of the website, rate limited",
  },
  i18n: {
    methods: ["POST"],
    kind: "public",
    reason:
      "the landing stores the visitor's language in a cookie; open on purpose (see the note in the file)",
  },
  "local/sync": {
    methods: ["POST"],
    kind: "cloud-refuses",
    reason:
      "does nothing without a local jobs.db, which a cloud deploy does not have",
  },
  messages: {
    methods: ["PATCH"],
    kind: "device-channel",
    reason:
      "only the box (a sync token) updates the status of a message; a session gets 403",
  },
  "pending-messages": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the chat written from the site, also from a phone: confirmed by the operator (22/10/2026); the message travels to the box as an async request",
  },
  "pending-messages/[id]/ack": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the chat written from the site, confirmed by the operator (22/10/2026): the user acknowledges a message of the team, an async request",
  },
  "pending-messages/[id]/reply": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the chat written from the site, confirmed by the operator (22/10/2026): the user's answer to a question of the team",
  },
  "positions/[legacyId]/feedback": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason: "like, dislike, hide: an async judgement that travels to the box",
  },
  "positions/[legacyId]/geocode-request": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L1",
    reason: "an async request to the team for precise coordinates",
  },
  "positions/[legacyId]/apply-request": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L3",
    gate: "requestAction",
    reason:
      "the authorisation to apply: the Closer then acts toward a company, so it is the highest-impact write of the site",
  },
  "positions/[legacyId]/mark-applied": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the user's own 'I applied' mark and its undo, on their own row; back on the site by the operator's decision (22/10/2026)",
  },
  "positions/[legacyId]/outcome": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the user's own outcome of an application (rejected, interview) and its undo; it only feeds statistics",
  },
  "positions/[legacyId]/user-note": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the user's private note on a position, on their own row; no agent reads it",
  },
  "positions/[legacyId]/recheck-request": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L1",
    reason: "an async request to the team to check the position again",
  },
  "positions/[legacyId]/ticket": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason: "a ticket opened on a position, an async request",
  },
  "positions/[legacyId]/user-exclude": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the user's exclusion of a position, an async request the box applies",
  },
  "positions/[legacyId]/write-request": {
    methods: ["POST", "DELETE"],
    kind: "request-lane",
    level: "L1",
    reason: "an async request to the team to write the CV",
  },
  "positions/seen": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the seen mark of a position: insert only, on the signed-in user's own row",
  },
  preferences: {
    methods: ["PATCH", "DELETE"],
    kind: "public",
    reason:
      "chrome preferences (theme, language, sounds); open on purpose (see the note in the file)",
  },
  "profile-exclusions": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the user's decision on a proposal to exclude a kind of position, on their own row; session only, never a device token",
  },
  "profile/files/request": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L1",
    reason:
      "the user asks the team for a file of the profile, an async request",
  },
  "team-state": {
    methods: ["PATCH"],
    kind: "device-channel",
    reason:
      "the box writes the observed state with its sync token; a session writes only the non-control fields",
  },
  "team-state/claim": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box claims the team state of its account, with its sync token",
  },
  "team-state/emergency-stop": {
    methods: ["POST"],
    kind: "request-lane",
    level: "L2",
    todo: "phase 2: request_action (today a session may only set should_run to false, never start)",
    reason:
      "the one declared exception to the control of the team: a stop, never a start",
  },
  "team-state/sync-observed": {
    methods: ["POST"],
    kind: "device-channel",
    reason: "the box syncs what it observed, with its sync token",
  },
  "team/command": {
    methods: ["POST"],
    kind: "cloud-refuses",
    reason:
      "the dispatch to the team bus answers 403 on the cloud deploy (enqueueIfRemote), before any insert",
  },
};

const census = censusOf(API, (route) => HELPERS[route] ?? {});
const open = census
  .map((r) => ({
    route: r.route,
    methods: r.handlers
      .filter((h) => h.state !== "guard-first")
      .map((h) => h.method),
  }))
  .filter((r) => r.methods.length > 0);

describe("the write routes of web/app/api", () => {
  it("finds the routes: the census is not empty", () => {
    expect(census.length).toBeGreaterThan(40);
    expect(census.map((r) => r.route)).toContain("agents/[id]");
  });

  it("every write handler starts with a write guard, or its route is listed with the reason", () => {
    const unlisted = open
      .map((r) => ({
        ...r,
        missing: r.methods.filter(
          (m) => !EXCEPTIONS[r.route]?.methods.includes(m),
        ),
      }))
      .filter((r) => r.missing.length > 0)
      .map((r) => `${r.route}: ${r.missing.join(", ")}`);
    expect(
      unlisted,
      `these write handlers have no guard (${WRITE_GUARDS.join(", ")}) before the body, the database or a process, ` +
        "and are not in EXCEPTIONS: guard them, or list them with the reason",
    ).toEqual([]);
  });

  it("a guard that comes after the body, the database or a process does not count", () => {
    const late = census.flatMap((r) =>
      r.handlers
        .filter((h) => h.state === "guard-late")
        .map((h) => `${r.route} ${h.method}`),
    );
    expect(late).toEqual([]);
  });

  it("the exceptions are alive: the route exists, each method is a write handler without a guard, and the reason is said", () => {
    const byRoute = new Map(open.map((r) => [r.route, r.methods]));
    const stale: string[] = [];
    for (const [route, exception] of Object.entries(EXCEPTIONS)) {
      const actual = byRoute.get(route);
      if (!actual)
        stale.push(
          `${route}: no unguarded write handler any more (guarded, removed or moved): drop the entry`,
        );
      else if (
        [...actual].sort().join() !== [...exception.methods].sort().join()
      )
        stale.push(
          `${route}: the entry lists ${exception.methods.join(",")} and the route has ${actual.join(",")}`,
        );
      if (exception.reason.trim().length < 20)
        stale.push(`${route}: the reason is missing or too short`);
    }
    expect(stale).toEqual([]);
  });
});

describe("the levels of the request lane (web capace)", () => {
  const lane = Object.entries(EXCEPTIONS).filter(
    ([, e]) => e.kind === "request-lane",
  );

  it("every request-lane exception says its level: L1, L2 or L3", () => {
    const wrong = lane
      .filter(([, e]) => !["L1", "L2", "L3"].includes(e.level ?? ""))
      .map(([route]) => route);
    expect(
      wrong,
      "a request-lane route needs level L1 (own data), L2 (commands the team) or L3 (acts outside)",
    ).toEqual([]);
  });

  it("a level only belongs to the request lane", () => {
    const stray = Object.entries(EXCEPTIONS)
      .filter(
        ([, e]) => e.kind !== "request-lane" && (e.level || e.gate || e.todo),
      )
      .map(([route]) => route);
    expect(stray).toEqual([]);
  });

  it("L2 and L3 go through requestAction, or name the phase that adds it", () => {
    const open = lane
      .filter(
        ([, e]) =>
          e.level !== "L1" &&
          e.gate !== "requestAction" &&
          !(e.todo ?? "").trim(),
      )
      .map(([route]) => route);
    expect(
      open,
      "an L2/L3 route needs gate: requestAction (checked) or a todo naming the phase",
    ).toEqual([]);
  });

  it("a route with a requestAction gate calls it before any write", () => {
    const late: string[] = [];
    for (const [route, e] of lane) {
      if (e.gate !== "requestAction") continue;
      const source = readFileSync(resolve(API, route, "route.ts"), "utf8");
      const states = writeHandlers(source, HELPERS[route] ?? {}, ACTION_GATES);
      for (const h of states)
        if (e.methods.includes(h.method) && h.state !== "guard-first")
          late.push(`${route} ${h.method}`);
    }
    expect(late).toEqual([]);
  });

  it("an L1 route never carries a todo", () => {
    expect(
      lane
        .filter(([, e]) => e.level === "L1" && e.todo)
        .map(([route]) => route),
    ).toEqual([]);
  });
});

describe("the requestAction gate is recognised where it must be", () => {
  const route = (order: string) => `
    export async function POST(req) {
${order}
      return Response.json({});
    }`;

  it("the call before the body and the database passes", () => {
    const source = route(
      `      const r = await requestAction({ action: "x" });\n      const body = await req.json();`,
    );
    expect(writeHandlers(source, {}, ACTION_GATES)).toEqual([
      { method: "POST", state: "guard-first" },
    ]);
  });

  it("the call after the body is late, and a route without it is open", () => {
    expect(
      writeHandlers(
        route(
          `      const body = await req.json();\n      await requestAction({});`,
        ),
        {},
        ACTION_GATES,
      ),
    ).toEqual([{ method: "POST", state: "guard-late" }]);
    expect(
      writeHandlers(
        route(`      const body = await req.json();`),
        {},
        ACTION_GATES,
      ),
    ).toEqual([{ method: "POST", state: "unguarded" }]);
  });
});

describe("the census catches what it is for", () => {
  const guarded = `
    export async function POST(req) {
      const ro = await requireLocalWrite();
      if (ro) return ro;
      const body = await req.json();
      return Response.json({ body });
    }`;

  it("a handler that starts with the guard passes", () => {
    expect(writeHandlers(guarded)).toEqual([
      { method: "POST", state: "guard-first" },
    ]);
  });

  it("a new route without a guard is red", () => {
    const route = `
      export async function POST(req) {
        const body = await req.json();
        return Response.json({ body });
      }
      export async function DELETE() {
        return Response.json({});
      }`;
    expect(writeHandlers(route)).toEqual([
      { method: "POST", state: "unguarded" },
      { method: "DELETE", state: "unguarded" },
    ]);
  });

  it("a guard after the body is read is late", () => {
    const route = `
      export async function PATCH(req) {
        const body = await req.json();
        const ro = await requireDesktopWrite();
        if (ro) return ro;
        return Response.json({ body });
      }`;
    expect(writeHandlers(route)).toEqual([
      { method: "PATCH", state: "guard-late" },
    ]);
  });

  it("the session check and a static reply may come before the guard", () => {
    const route = `
      export async function POST(req, { params }) {
        const { id } = await params;
        if (isDemoLegacyId(id)) return NextResponse.json({ id: "demo" });
        const denied = await requireAuth();
        if (denied) return denied;
        const ro = await requireDesktopWrite();
        if (ro) return ro;
        return NextResponse.json(await req.json());
      }`;
    expect(writeHandlers(route)).toEqual([
      { method: "POST", state: "guard-first" },
    ]);
  });

  it("a guard that stands in another handler of the file does not cover this one", () => {
    const route = `
      export async function POST(req) {
        const ro = await requireLocalWrite();
        if (ro) return ro;
        return Response.json({});
      }
      export async function DELETE(req) {
        const body = await req.json();
        return Response.json({ body });
      }`;
    expect(writeHandlers(route)).toEqual([
      { method: "POST", state: "guard-first" },
      { method: "DELETE", state: "unguarded" },
    ]);
  });

  it("a handler built as a constant is found, and is open until listed", () => {
    expect(writeHandlers("export const PUT = handler;")).toEqual([
      { method: "PUT", state: "unguarded" },
    ]);
  });

  it("the guard kept in a local helper is looked for in the helper", () => {
    const route = `
      async function handle(req) {
        const ro = await requireDesktopWrite();
        if (ro) return ro;
        return Response.json(await req.json());
      }
      export async function POST(req) {
        return handle(req);
      }`;
    expect(writeHandlers(route, { POST: "handle" })).toEqual([
      { method: "POST", state: "guard-first" },
    ]);
    expect(writeHandlers(route)).toEqual([
      { method: "POST", state: "unguarded" },
    ]);
  });
});
