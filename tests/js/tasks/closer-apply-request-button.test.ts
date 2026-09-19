/**
 * Il bottone «candidati» e la regola che lo governa. [JHT-CLOSER]
 *
 * Il click dal sito È l'autorizzazione a inviare: il CLOSER non chiede un
 * secondo consenso. Questi test provano i quattro punti in cui un difetto
 * manderebbe (o fermerebbe) una candidatura vera:
 *
 * - la regola del sito È il JSON che legge il gate del box, non una copia;
 * - la route rifiuta ciò che è già partito, in POST e in DELETE, e quando
 *   scrive muove `updated_at` (il cursore del push) e un istante sempre nuovo;
 * - la risposta a una domanda del CLOSER segue la stessa regola;
 * - il bottone chiama la route solo dopo la conferma e mostra gli stati
 *   autorizzata / in invio / inviata con ricevuta / fermata.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");
const React = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};

const home = mkdtempSync(join(tmpdir(), "jht-apply-request-button-"));
process.env.JHT_HOME = home;
const dbPath = join(home, "jobs.db");

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(() => {
    throw new Error("cloud path must not run for local-token requests");
  }),
}));
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht_local_token",
  isLocalTokenAuthenticated: vi.fn(() => true),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: Record<string, unknown>) =>
    React.createElement("a", { href, ...rest }, children),
}));

const rule = await import("@/lib/apply-request-rule");
const route =
  await import("@/app/api/positions/[legacyId]/apply-request/route");
const button =
  await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
const { T } =
  await import("@/app/(protected)/positions/[id]/ApplyRequestButton.i18n");
const { makeT } = await import("@/lib/i18n-dict");

function seed() {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(dbPath + suffix, { force: true });
  }
  const db = new Database(dbPath);
  // Il lettore del sito apre in sola lettura e chiede WAL: il box è già così.
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT,
      apply_requested INTEGER DEFAULT 0, apply_requested_at TEXT,
      apply_requested_by TEXT, updated_at TEXT
    );
    CREATE TABLE applications (
      id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE,
      applied INTEGER DEFAULT 0, applied_at TEXT, applied_via TEXT
    );
    CREATE TABLE pending_user_messages (
      id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT,
      related_position_id INTEGER, source_action TEXT, source_payload TEXT,
      user_reply TEXT, user_reply_at TEXT, acknowledged_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO positions (id, title, company, status, updated_at) VALUES
      (1, 'Synthetic ready', 'Synthetic company', 'ready', '2026-01-01 00:00:00.000'),
      (2, 'Synthetic review', 'Synthetic company', 'review', '2026-01-01 00:00:00.000'),
      (3, 'Synthetic applied', 'Synthetic company', 'applied', '2026-01-01 00:00:00.000'),
      (4, 'Synthetic ready sent', 'Synthetic company', 'ready', '2026-01-01 00:00:00.000');
    INSERT INTO applications (position_id, applied, applied_via) VALUES
      (1, 0, NULL), (4, 1, 'agent_closer');
    UPDATE positions SET apply_requested = 1,
      apply_requested_at = '2026-01-01T00:00:00.000Z',
      apply_requested_by = 'user_web'
     WHERE id IN (3, 4);
  `);
  db.close();
}

function row(id: number) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT status, apply_requested, apply_requested_at, apply_requested_by, updated_at FROM positions WHERE id = ?",
      )
      .get(id) as Record<string, unknown>;
  } finally {
    db.close();
  }
}

async function refusal(outcome: ReturnType<typeof route.toggleViaLocal>) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("unexpectedly allowed");
  return { status: outcome.res.status, body: await outcome.res.json() };
}

beforeEach(seed);
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("la regola del sito è il JSON del gate", () => {
  it("le costanti sono quelle di shared/cloud/apply-request-rule.json", () => {
    const file = JSON.parse(
      readFileSync(join(repo, "shared/cloud/apply-request-rule.json"), "utf8"),
    );
    expect(rule.AUTHORISABLE_STATUS).toBe(file.authorisable_status);
    expect([...rule.POST_SUBMISSION_STATES]).toEqual(
      file.post_submission_states,
    );
    expect([...rule.USER_REQUEST_ORIGINS]).toEqual(file.user_request_origins);
  });

  it("una regola rotta chiude tutto", () => {
    for (const broken of [
      null,
      {},
      { authorisable_status: "ready" },
      "ready",
    ]) {
      const closed = rule.parseApplyRequestRule(broken);
      expect(
        rule.applyToggleVerdict(
          { status: "ready", applied: false, requested: true },
          closed,
        ),
      ).toEqual({ ok: false, reason: "rule_unavailable" });
    }
  });

  it("l'istante nuovo è sempre dopo il precedente", () => {
    const now = new Date("2026-09-13T10:00:00.000Z");
    expect(rule.nextApplyInstant(null, now)).toBe("2026-09-13T10:00:00.000Z");
    expect(rule.nextApplyInstant("2999-01-01T00:00:00.000Z", now)).toBe(
      "2999-01-01T00:00:00.001Z",
    );
    expect(rule.nextApplyInstant("2026-09-13 10:00:00", now)).toBe(
      "2026-09-13T10:00:00.001Z",
    );
  });
});

describe("la route apply-request, path locale", () => {
  it("autorizza una ready: autore, istante ISO nuovo e updated_at mosso", () => {
    const before = row(1);
    const outcome = route.toggleViaLocal(1, true, "user_web");
    expect(outcome.ok).toBe(true);
    const after = row(1);
    expect(after.apply_requested).toBe(1);
    expect(after.apply_requested_by).toBe("user_web");
    expect(String(after.apply_requested_at)).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(String(after.updated_at) > String(before.updated_at)).toBe(true);
  });

  it("istante e updated_at avanzano anche contro un orologio indietro", () => {
    const db = new Database(dbPath);
    db.exec(`UPDATE positions
                SET apply_requested_at = '2999-01-01T00:00:00.000Z',
                    updated_at = '2999-01-01 00:00:00.000'
              WHERE id = 1`);
    db.close();
    expect(route.toggleViaLocal(1, true, "user_web").ok).toBe(true);
    const after = row(1);
    expect(after.apply_requested_at).toBe("2999-01-01T00:00:00.001Z");
    expect(after.updated_at).toBe("2999-01-01 00:00:00.001");
  });

  it("rifiuta una posizione non ready senza scrivere", async () => {
    const before = row(2);
    const { status, body } = await refusal(
      route.toggleViaLocal(2, true, "user_web"),
    );
    expect(status).toBe(409);
    expect(body.error).toBe("position_not_ready");
    expect(row(2)).toEqual(before);
  });

  it.each([
    [3, true],
    [3, false],
    [4, true],
    [4, false],
  ])(
    "posizione %i già inviata: %s rifiutato con 409 already_submitted",
    async (id, requested) => {
      const before = row(id);
      const { status, body } = await refusal(
        route.toggleViaLocal(id, requested, "user_web"),
      );
      expect(status).toBe(409);
      expect(body.error).toBe("already_submitted");
      expect(row(id)).toEqual(before);
    },
  );

  it("il ritiro spegne flag e autore; ritirare il niente non scrive", () => {
    const untouched = row(1);
    expect(route.toggleViaLocal(1, false, "user_web").ok).toBe(true);
    expect(row(1)).toEqual(untouched);

    route.toggleViaLocal(1, true, "user_web");
    const on = row(1);
    expect(route.toggleViaLocal(1, false, "user_web").ok).toBe(true);
    const off = row(1);
    expect(off.apply_requested).toBe(0);
    expect(off.apply_requested_by).toBeNull();
    expect(String(off.apply_requested_at) > String(on.apply_requested_at)).toBe(
      true,
    );
    expect(String(off.updated_at) > String(on.updated_at)).toBe(true);
  });
});

describe("la risposta a una domanda del CLOSER segue la stessa regola", () => {
  function question(positionId: number) {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO pending_user_messages (
         id, agent, body, kind, related_position_id, source_action, source_payload
       ) VALUES (9, 'closer', 'Fixture question', 'question', ?,
         'closer_application_answer', ?)`,
    ).run(
      positionId,
      JSON.stringify({
        version: 1,
        position_id: positionId,
        key: "work_mode",
        label: "Work mode?",
        field_type: "radio",
        options: ["Remote", "Hybrid"],
      }),
    );
    db.close();
  }

  it("rinnova il permesso e muove updated_at", async () => {
    question(1);
    const before = row(1);
    vi.resetModules();
    const { replyPendingMessageLocal } =
      await import("@/lib/pending-message-reply-local");
    expect(replyPendingMessageLocal("9", "Remote")).toBe(true);
    const after = row(1);
    expect(after.apply_requested_by).toBe("user_local");
    expect(String(after.updated_at) > String(before.updated_at)).toBe(true);
  });

  it("non riautorizza una candidatura già inviata e non consuma la risposta", async () => {
    question(4);
    const before = row(4);
    vi.resetModules();
    const { replyPendingMessageLocal } =
      await import("@/lib/pending-message-reply-local");
    expect(() => replyPendingMessageLocal("9", "Remote")).toThrow(
      "closer_answer_already_submitted",
    );
    expect(row(4)).toEqual(before);
    const db = new Database(dbPath, { readonly: true });
    expect(
      db
        .prepare("SELECT user_reply FROM pending_user_messages WHERE id = 9")
        .get(),
    ).toEqual({ user_reply: null });
    db.close();
  });
});

describe("gli stati del bottone", () => {
  const base = {
    status: "ready",
    apply_requested: true,
    apply_requested_at: "2026-09-13T10:00:00.000Z",
    application: { applied: false, applied_at: null, applied_via: null },
    closerQuestion: null,
    checkpoint: null,
  };

  it("calcola nascosto / disponibile / autorizzata / in invio / fermata / inviata", () => {
    expect(
      rule.applyRequestState({
        ...base,
        status: "review",
        apply_requested: false,
      }).kind,
    ).toBe("hidden");
    expect(
      rule.applyRequestState({ ...base, apply_requested: false }).kind,
    ).toBe("available");
    expect(rule.applyRequestState(base)).toEqual({
      kind: "authorised",
      at: base.apply_requested_at,
    });
    expect(
      rule.applyRequestState({
        ...base,
        checkpoint: {
          state: "fill",
          updated_at: "2026-09-13T10:01:00+00:00",
          blocked_reason: "",
        },
      }),
    ).toEqual({ kind: "sending", step: "fill" });
    expect(
      rule.applyRequestState({
        ...base,
        checkpoint: {
          state: "blocked_human",
          updated_at: "2026-09-13T10:02:00+00:00",
          blocked_reason: "captcha",
        },
      }),
    ).toEqual({ kind: "stopped", reason: "captcha", messageId: null });
    expect(
      rule.applyRequestState({
        ...base,
        closerQuestion: {
          id: "9",
          body: "Work mode?",
          created_at: "2026-09-13 10:03:00",
          user_reply: null,
        },
      }),
    ).toEqual({ kind: "stopped", reason: "Work mode?", messageId: "9" });
    expect(
      rule.applyRequestState({
        ...base,
        status: "applied",
        application: {
          applied: true,
          applied_at: "2026-09-13T10:05:00Z",
          applied_via: "agent_closer",
        },
      }),
    ).toEqual({
      kind: "sent",
      at: "2026-09-13T10:05:00Z",
      via: "agent_closer",
      withReceipt: true,
    });
  });

  it("una fermata PRIMA della nuova autorizzazione non ferma più", () => {
    expect(
      rule.applyRequestState({
        ...base,
        closerQuestion: {
          id: "9",
          body: "Work mode?",
          created_at: "2026-09-13 09:59:00",
          user_reply: null,
        },
        checkpoint: {
          state: "blocked_human",
          updated_at: "2026-09-13T09:59:30+00:00",
          blocked_reason: "captcha",
        },
      }).kind,
    ).toBe("authorised");
  });

  it("il checkpoint del box si legge dal JHT_HOME", async () => {
    const db = new Database(dbPath);
    db.exec(
      "INSERT INTO pending_user_messages (id, agent, body, kind, related_position_id) VALUES (11, 'closer', 'Captcha', 'question', 1)",
    );
    db.close();
    mkdirSync(join(home, ".cache", "apply-flow"), { recursive: true });
    writeFileSync(
      join(home, ".cache", "apply-flow", "1.json"),
      JSON.stringify({
        state: "screening",
        updated_at: "2026-09-13T10:00:00+00:00",
        blocked_reason: "",
      }),
    );
    const local = await import("@/lib/local-queries");
    const signals = local.getApplyRequestSignalsLocal(home, "1");
    expect(signals.checkpoint).toEqual({
      state: "screening",
      updated_at: "2026-09-13T10:00:00+00:00",
      blocked_reason: "",
    });
    expect(signals.closerQuestion).toMatchObject({ id: "11", body: "Captcha" });
  });
});

describe("il bottone", () => {
  const t = makeT(T, "en");
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      React.createElement(button.ApplyRequestView, { t, ...props }),
    );

  it("chiama la route con il metodo giusto e riporta il rifiuto", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const ok = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await button.submitApplyRequest(7, true, ok)).toEqual({ ok: true });
    expect(await button.submitApplyRequest(7, false, ok)).toEqual({ ok: true });
    expect(calls).toEqual([
      ["/api/positions/7/apply-request", { method: "POST" }],
      ["/api/positions/7/apply-request", { method: "DELETE" }],
    ]);
    const refused = (async () =>
      new Response(JSON.stringify({ error: "already_submitted" }), {
        status: 409,
      })) as unknown as typeof fetch;
    const outcome = await button.submitApplyRequest(7, true, refused);
    expect(outcome).toEqual({ ok: false, error: "already_submitted" });
    expect(button.refusalText(t, "already_submitted")).toBe(
      T.refused_already_submitted.en,
    );
  });

  it("il click apre la conferma, che dice che l'invio è automatico", () => {
    const closed = html({ state: { kind: "available" } });
    expect(closed).toContain('data-action="authorise"');
    expect(closed).not.toContain("alertdialog");
    const open = html({ state: { kind: "available" }, confirming: true });
    expect(open).toContain('role="alertdialog"');
    expect(open).toContain(T.confirm_body.en.replace("'", "&#x27;"));
    expect(open).toContain('data-action="confirm"');
  });

  it("mostra autorizzata, in invio, inviata con ricevuta e fermata", () => {
    const authorised = html({ state: { kind: "authorised", at: null } });
    expect(authorised).toContain('data-apply-state="authorised"');
    expect(authorised).toContain(T.authorised_desc.en);
    expect(authorised).toContain('data-action="withdraw"');

    const sending = html({ state: { kind: "sending", step: "fill" } });
    expect(sending).toContain("(fill)");
    expect(sending).not.toContain("data-action");

    const sent = html({
      state: { kind: "sent", at: null, via: "agent_closer", withReceipt: true },
    });
    expect(sent).toContain(T.sent_receipt_desc.en);
    expect(sent).not.toContain("data-action");

    const stopped = html({
      state: { kind: "stopped", reason: "Captcha on the form", messageId: "9" },
    });
    expect(stopped).toContain("Captcha on the form");
    expect(stopped).toContain('href="/messages"');
    expect(stopped).toContain('data-action="reauthorise"');

    expect(html({ state: { kind: "hidden" } })).toBe("");
  });
});
