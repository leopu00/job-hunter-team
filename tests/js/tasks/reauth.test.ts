/**
 * «Sign in again» when the door asks for a recent sign-in (T63).
 *
 * The door answers `reauth_required` when the session is older than fifteen minutes. The button then offers
 * to sign in again and, once back, starts the FIRST step of the confirmation again, but only for the same
 * account that asked. It never confirms: the second step stays a click of the person.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const React = requireFromWeb("react");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};

class FakeStorage {
  map = new Map<string, string>();
  failSet = false;
  failGet = false;
  getItem(key: string) {
    if (this.failGet) throw new Error("blocked");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error("quota");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const world = {
  user: { id: USER, app_metadata: { provider: "google" } } as unknown,
  getUserThrows: false,
  oauthError: null as unknown,
  oauth: [] as Array<Record<string, any>>,
  storage: new FakeStorage(),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        if (world.getUserThrows) throw new Error("network");
        return { data: { user: world.user } };
      },
      signInWithOAuth: async (args: Record<string, any>) => {
        world.oauth.push(args);
        return { error: world.oauthError };
      },
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: Record<string, unknown>) =>
    React.createElement("a", { href, ...rest }, children),
}));

const intent = await import("@/lib/reauth-intent");
const reauth = await import("@/lib/reauth");
const button =
  await import("@/app/(protected)/positions/[id]/ApplyRequestButton");
const { T } =
  await import("@/app/(protected)/positions/[id]/ApplyRequestButton.i18n");
const { makeT } = await import("@/lib/i18n-dict");

const NOW = 1_800_000_000_000;
const target = { kind: "apply-authorise" as const, target: "7" };
const stored = { ...target, userId: USER };

beforeEach(() => {
  world.user = { id: USER, app_metadata: { provider: "google" } };
  world.getUserThrows = false;
  world.oauthError = null;
  world.oauth = [];
  world.storage = new FakeStorage();
  (globalThis as any).window = {
    sessionStorage: world.storage,
    location: {
      origin: "https://site.example",
      pathname: "/positions/7",
      search: "?tab=cv",
    },
  };
});

describe("the intention kept across the sign-in", () => {
  const take = (
    expected = target,
    now = NOW + 1000,
    uid: string | null = USER,
  ) => intent.takeReauthIntent(world.storage, expected, now, uid);
  const save = (at = NOW) =>
    intent.saveReauthIntent(world.storage, { ...stored, at });

  it("is read once: the first page that takes it removes it, whatever the answer", () => {
    expect(save()).toBe(true);
    expect(take()).toBe("resume");
    expect(take()).toBe("none");
    // a page that is not the one still consumes it: no other tab or render can use it later
    save();
    expect(take({ kind: "apply-authorise", target: "8" })).toBe("none");
    expect(world.storage.map.size).toBe(0);
  });

  it("is only for the very thing it names", () => {
    save();
    expect(take({ kind: "team-command", target: "7" })).toBe("none");
    save();
    expect(take({ kind: "apply-authorise", target: "70" })).toBe("none");
  });

  it("is only for the SAME account: another one on the way back resumes nothing and is told", () => {
    save();
    expect(take(target, NOW + 1000, OTHER)).toBe("changed");
    expect(world.storage.map.size).toBe(0);
    // an account that cannot be read is never «the same»
    save();
    expect(take(target, NOW + 1000, null)).toBe("changed");
    // but a page the intention was not for says nothing about accounts
    save();
    expect(take({ kind: "team-command", target: "7" }, NOW + 1000, OTHER)).toBe(
      "none",
    );
  });

  it("lasts ten minutes, not a moment more, and is never from the future", () => {
    const at = (age: number) => {
      save();
      return take(target, NOW + age);
    };
    expect(at(10 * 60 * 1000)).toBe("resume");
    expect(at(10 * 60 * 1000 + 1)).toBe("none");
    expect(at(-1)).toBe("none");
  });

  it.each([
    ["not json", "{nope"],
    ["null", "null"],
    ["a string", '"x"'],
    ["an array", "[]"],
    ["no instant", JSON.stringify({ ...stored })],
    [
      "an instant that is a string",
      JSON.stringify({ ...stored, at: String(NOW) }),
    ],
    [
      "an instant that is not finite",
      `{"kind":"apply-authorise","target":"7","userId":"${USER}","at":1e999}`,
    ],
    ["no account", JSON.stringify({ ...target, at: NOW })],
    [
      "an account that is not a plain id",
      JSON.stringify({ ...target, userId: "../x", at: NOW }),
    ],
  ])("%s is no intention", (_name, raw) => {
    world.storage.setItem(intent.REAUTH_INTENT_KEY, raw);
    expect(take()).toBe("none");
    expect(world.storage.map.size).toBe(0);
  });

  it("holds nothing but a kind, a plain target, who and an instant, and refuses anything else", () => {
    const bad = (extra: Record<string, unknown>) =>
      intent.saveReauthIntent(world.storage, {
        ...stored,
        ...extra,
        at: NOW,
      } as never);
    expect(bad({ target: "../x" })).toBe(false);
    expect(bad({ target: "a b" })).toBe(false);
    expect(bad({ target: "x".repeat(65) })).toBe(false);
    expect(bad({ kind: "other" })).toBe(false);
    expect(bad({ userId: "a b" })).toBe(false);
    expect(bad({ userId: "" })).toBe(false);
    expect(world.storage.map.size).toBe(0);
    save();
    expect(
      JSON.parse(world.storage.map.get(intent.REAUTH_INTENT_KEY)!),
    ).toEqual({ ...stored, at: NOW });
  });

  it("a storage that refuses is no reason to fail: the shortcut is simply lost", () => {
    world.storage.failSet = true;
    expect(save()).toBe(false);
    world.storage.failSet = false;
    world.storage.failGet = true;
    expect(take()).toBe("none");
  });
});

describe("where the sign-in goes, and where it comes back", () => {
  it("only the provider the person signed in with, and only the two the site offers", () => {
    expect(
      intent.reauthProviderOf({ app_metadata: { provider: "google" } }),
    ).toBe("google");
    expect(
      intent.reauthProviderOf({ app_metadata: { provider: "github" } }),
    ).toBe("github");
    for (const user of [
      null,
      undefined,
      {},
      { app_metadata: {} },
      { app_metadata: { provider: "email" } },
      { app_metadata: { provider: "apple" } },
      { app_metadata: { provider: ["google"] } },
      "google",
    ]) {
      expect(intent.reauthProviderOf(user)).toBeNull();
    }
  });

  it("knows the account only when it is a plain id", () => {
    expect(intent.userIdOf({ id: USER })).toBe(USER);
    for (const user of [null, {}, { id: 7 }, { id: "a b" }, { id: "" }])
      expect(intent.userIdOf(user)).toBeNull();
  });

  it("comes back to the site's callback, which goes on to this page; never to another host", () => {
    const url = new URL(
      intent.reauthCallbackUrl("https://site.example", {
        pathname: "/positions/7",
        search: "?tab=cv",
      }),
    );
    expect(url.origin).toBe("https://site.example");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/positions/7?tab=cv");
    for (const pathname of ["//evil.example/x", "evil.example", ""]) {
      expect(
        new URL(
          intent.reauthCallbackUrl("https://site.example", {
            pathname,
            search: "",
          }),
        ).searchParams.has("next"),
      ).toBe(false);
    }
  });
});

describe("signing in again on the site", () => {
  it("goes to the person's own provider, back to this page, after writing the intention with who asked", async () => {
    expect(await reauth.startReauth(target)).toBe("redirected");
    expect(world.oauth).toHaveLength(1);
    const call = world.oauth[0];
    expect(call.provider).toBe("google");
    expect(call.options.queryParams).toEqual({ prompt: "select_account" });
    const back = new URL(call.options.redirectTo);
    expect(back.pathname).toBe("/auth/callback");
    expect(back.searchParams.get("next")).toBe("/positions/7?tab=cv");
    const saved = JSON.parse(world.storage.map.get(intent.REAUTH_INTENT_KEY)!);
    expect(saved).toMatchObject(stored);
    expect(typeof saved.at).toBe("number");
  });

  it("github has no account chooser to ask for", async () => {
    world.user = { id: USER, app_metadata: { provider: "github" } };
    expect(await reauth.startReauth(target)).toBe("redirected");
    expect(world.oauth[0].provider).toBe("github");
    expect(world.oauth[0].options.queryParams).toBeUndefined();
  });

  it("a provider the site cannot repeat leaves everything as it was, and offers no button", async () => {
    world.user = { id: USER, app_metadata: { provider: "email" } };
    expect(await reauth.startReauth(target)).toBe("unsupported");
    expect(world.oauth).toEqual([]);
    expect(world.storage.map.size).toBe(0);
    expect(await reauth.canReauth()).toBe(false);
  });

  it("without an account it can name nothing starts: the intention would be for nobody", async () => {
    world.user = { app_metadata: { provider: "google" } };
    expect(await reauth.startReauth(target)).toBe("unsupported");
    expect(world.oauth).toEqual([]);
    expect(await reauth.canReauth()).toBe(false);
    expect(await reauth.currentUserId()).toBeNull();
  });

  it("says who is signed in, and that both providers of the site can sign in again", async () => {
    expect(await reauth.currentUserId()).toBe(USER);
    expect(await reauth.canReauth()).toBe(true);
    world.user = { id: USER, app_metadata: { provider: "github" } };
    expect(await reauth.canReauth()).toBe(true);
    world.getUserThrows = true;
    expect(await reauth.canReauth()).toBe(false);
    expect(await reauth.currentUserId()).toBeNull();
  });

  it("a failure is said, not hidden: an error from the provider, or a session that cannot be read", async () => {
    world.oauthError = { message: "boom" };
    expect(await reauth.startReauth(target)).toBe("failed");
    world.oauthError = null;
    world.getUserThrows = true;
    expect(await reauth.startReauth(target)).toBe("failed");
  });
});

describe("what the button shows and does", () => {
  const html = (props: Record<string, unknown>, locale = "en") =>
    renderToStaticMarkup(
      React.createElement(button.ApplyRequestView, {
        t: makeT(T, locale),
        ...props,
      }),
    );
  const available = { kind: "available" as const };
  const src = readFileSync(
    join(repo, "web/app/(protected)/positions/[id]/ApplyRequestButton.tsx"),
    "utf8",
  );

  it("offers «sign in again» only when the door asked for it, in the seven languages", () => {
    expect(html({ state: available })).not.toContain('data-action="reauth"');
    for (const locale of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      const out = html(
        { state: available, reauth: { onClick() {}, busy: false } },
        locale,
      );
      expect(out, locale).toContain('data-action="reauth"');
      expect(out, locale).toContain(makeT(T, locale)("reauth_button"));
    }
    expect(
      html({ state: available, reauth: { onClick() {}, busy: true } }),
    ).toMatch(/data-action="reauth"[^>]*disabled/);
  });

  it("the container offers it only on the site's road, on this very refusal, and when this account can repeat it", () => {
    expect(src).toMatch(/twoStep && outcome\.error === "reauth_required"/);
    expect(src).toMatch(/void canReauth\(\)\.then\(setNeedsReauth\)/);
    expect(src).toMatch(
      /startReauth\(\{\s*kind: "apply-authorise",\s*target: String\(legacyId\),?\s*\}\)/,
    );
  });

  it("back from the sign-in it restarts the FIRST step only, only for the same account, and never confirms", () => {
    const start = src.indexOf("useEffect(() => {\n    if (!twoStep) return;");
    expect(start).toBeGreaterThan(0);
    const effect = src.slice(start, src.indexOf("}, []);", start));
    expect(effect).toContain("await currentUserId()");
    expect(effect).toContain("takeReauthIntent(");
    expect(effect).toMatch(/taken === "resume"\) void startTwoStep\(\)/);
    expect(effect).toMatch(
      /taken === "changed"\) setError\(t\("reauth_other_account"\)\)/,
    );
    expect(effect).not.toMatch(/confirmTwoStep|confirmAuthorisation|confirmId/);
    // the sign-in that ends without a reload (desktop) follows the same rule
    const at = src.indexOf("const reauthenticate");
    const after = src.slice(at, at + 1400);
    expect(after).toMatch(/result === "done"\)[\s\S]*await startTwoStep\(\)/);
    expect(after).toMatch(/result === "changed"\)[\s\S]*reauth_other_account/);
    expect(after).not.toMatch(/confirmTwoStep|confirmAuthorisation/);
  });

  it("the account-changed and the could-not-open sentences exist in the seven languages", () => {
    for (const locale of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      for (const key of [
        "reauth_other_account",
        "reauth_failed",
        "reauth_button",
      ] as const) {
        expect(
          makeT(T, locale)(key).length,
          `${locale} ${key}`,
        ).toBeGreaterThan(8);
      }
    }
  });
});

describe("the team commands of the Panel (the whole team, the only one that waits for a confirmation)", () => {
  const team = readFileSync(
    join(repo, "web/app/(protected)/team/TeamControl.tsx"),
    "utf8",
  );

  it("peeks at what was asked without consuming it, trusts nothing, and the page still takes it", () => {
    intent.saveReauthIntent(world.storage, {
      kind: "team-command",
      target: "restart:all",
      userId: USER,
      at: NOW,
    });
    expect(intent.peekReauthTarget(world.storage, "team-command")).toBe(
      "restart:all",
    );
    expect(
      intent.peekReauthTarget(world.storage, "apply-authorise"),
    ).toBeNull();
    expect(world.storage.map.size).toBe(1);
    expect(
      intent.takeReauthIntent(
        world.storage,
        { kind: "team-command", target: "restart:all" },
        NOW + 1,
        USER,
      ),
    ).toBe("resume");
    expect(intent.peekReauthTarget(world.storage, "team-command")).toBeNull();
    world.storage.setItem(
      intent.REAUTH_INTENT_KEY,
      JSON.stringify({
        kind: "team-command",
        target: "../x",
        userId: USER,
        at: NOW,
      }),
    );
    expect(intent.peekReauthTarget(world.storage, "team-command")).toBeNull();
    world.storage.setItem(intent.REAUTH_INTENT_KEY, "{nope");
    expect(intent.peekReauthTarget(world.storage, "team-command")).toBeNull();
    world.storage.failGet = true;
    expect(intent.peekReauthTarget(world.storage, "team-command")).toBeNull();
  });

  it("offers «sign in again» only for the whole team: a single agent's first call IS the command", () => {
    expect(team).toMatch(
      /answer\.code === "reauth_required" && forTarget === "all"/,
    );
    expect(team).toMatch(/void canReauth\(\)\.then/);
    expect(team).toMatch(/target: `\$\{action\}:all`/);
  });

  it("back from the sign-in it resumes only start|stop|restart for the whole team, as the same account, with the first call", () => {
    const start = team.indexOf("peekReauthTarget(");
    const effect = team.slice(
      team.lastIndexOf("useEffect(() => {", start),
      team.indexOf("}, []);", start),
    );
    expect(effect).toContain("await currentUserId()");
    expect(effect).toContain("takeReauthIntent(");
    expect(effect).toMatch(/\^\(start\|stop\|restart\):all\$/);
    expect(effect).toMatch(/taken === "resume" && action/);
    expect(effect).toMatch(/send\(firstCall\(action, "all"\), action, "all"\)/);
    expect(effect).toMatch(
      /taken === "changed"\) \{?\s*setError\("err_other_account"\)/,
    );
    expect(effect).not.toMatch(/confirmCall/);
    // and not in the desktop, where the page does not show these controls
    expect(effect).toMatch(/desktopControls \|\| !teamControlEnabled\(\)/);
  });

  it("the sign-in button itself restarts the first call only, for the same account", () => {
    const at = team.indexOf("const reauthenticate");
    const body = team.slice(at, at + 1100);
    expect(body).toMatch(
      /result === "done"\)[\s\S]*send\(firstCall\(action, "all"\)/,
    );
    expect(body).toMatch(/result === "changed"\)[\s\S]*err_other_account/);
    expect(body).not.toMatch(/confirmCall/);
  });

  it("the sentences exist in the seven languages", async () => {
    const { T: TT } = await import("@/app/(protected)/team/TeamControl.i18n");
    for (const locale of ["it", "en", "hu", "es", "de", "fr", "pt"]) {
      for (const key of [
        "reauth_button",
        "err_other_account",
        "err_reauth_failed",
      ] as const) {
        expect(
          makeT(TT, locale)(key).length,
          `${locale} ${key}`,
        ).toBeGreaterThan(8);
      }
    }
  });
});
