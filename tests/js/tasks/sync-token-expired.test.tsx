// @vitest-environment jsdom
/**
 * A box's sync token expired on the website and its box failed every push for
 * 16 days without anybody seeing it: the token list showed it among the active
 * ones and no page said anything. Now:
 *  - the list keeps expired tokens apart, says their box is disconnected and
 *    offers «Renew» (the form, with the same name, ready to generate);
 *  - every page carries a band while a box that was in use has its token
 *    expired, or expiring within the warning days, with the way to renew it.
 * Synthetic data only.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock("next/link", () => {
  const { createElement } = createRequire(
    path.resolve(__dirname, "../../../web/package.json"),
  )("react");
  return {
    default: ({ href, children, ...rest }: Record<string, unknown>) =>
      createElement("a", { href, ...rest }, children),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => ({
        is: async (column: string, value: unknown) => {
          expect(table).toBe("cloud_sync_tokens");
          expect(columns).toBe("name, expires_at, client_seen_at");
          expect([column, value]).toEqual(["revoked_at", null]);
          return { data: rows.data, error: null };
        },
      }),
    }),
  }),
}));

import CloudTokensClient from "../../../web/app/(protected)/settings/cloud-sync/CloudTokensClient";
import SyncTokenBanner from "../../../web/app/components/SyncTokenBanner";
import { boxTokenTroubles } from "../../../web/lib/cloud-sync/token-banner";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 23, 18, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

describe("which boxes to warn about", () => {
  it("an expired token whose box was in use, and one about to expire", () => {
    const troubles = boxTokenTroubles(
      [
        { name: "far", expires_at: iso(NOW + 60 * DAY), client_seen_at: iso(NOW - DAY) },
        { name: "none", expires_at: null, client_seen_at: iso(NOW - DAY) },
        { name: "soon", expires_at: iso(NOW + 3 * DAY), client_seen_at: iso(NOW - DAY) },
        { name: "gone", expires_at: iso(NOW - 16 * DAY), client_seen_at: iso(NOW - 16 * DAY - 3_600_000) },
      ],
      NOW,
    );
    expect(troubles).toEqual([
      { kind: "expired", name: "gone", expiresAt: iso(NOW - 16 * DAY) },
      { kind: "expiring", name: "soon", expiresAt: iso(NOW + 3 * DAY), daysLeft: 3 },
    ]);
  });

  it("a token whose box was not in use is a forgotten one, not a box gone silent", () => {
    expect(
      boxTokenTroubles(
        [
          { name: "never", expires_at: iso(NOW - DAY), client_seen_at: null },
          { name: "idle", expires_at: iso(NOW - DAY), client_seen_at: iso(NOW - 45 * DAY) },
          { name: "idle-soon", expires_at: iso(NOW + 2 * DAY), client_seen_at: iso(NOW - 40 * DAY) },
          { name: "garbled", expires_at: "not a date", client_seen_at: iso(NOW) },
        ],
        NOW,
      ),
    ).toEqual([]);
  });
});

let container: HTMLDivElement;
let root: { render(el: unknown): void; unmount(): void };

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  rows.data = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

describe("the band on every page", () => {
  it("says the box is disconnected and leads to the renewal", async () => {
    const expiredAt = iso(Date.now() - 16 * DAY);
    rows.data = [{ name: "box-synthetic", expires_at: expiredAt, client_seen_at: iso(Date.now() - 16 * DAY - 60_000) }];
    await act(async () => root.render(createElement(SyncTokenBanner)));
    await settle();
    const band = container.querySelector('[data-sync-token-banner="expired"]');
    expect(band?.getAttribute("role")).toBe("alert");
    expect(band?.textContent).toContain("box-synthetic");
    expect(band?.textContent).toContain(expiredAt.slice(0, 10));
    expect(band?.querySelector("a")?.getAttribute("href")).toBe("/settings/cloud-sync");
  });

  it("stays away when every box is fine", async () => {
    rows.data = [{ name: "box-synthetic", expires_at: null, client_seen_at: iso(Date.now()) }];
    await act(async () => root.render(createElement(SyncTokenBanner)));
    await settle();
    expect(container.querySelector("[data-sync-token-banner]")).toBeNull();
  });
});

describe("the token list", () => {
  it("keeps an expired token out of the active ones, and «Renew» prepares the form", async () => {
    const expired = {
      id: "token-expired",
      name: "box-synthetic",
      token_prefix: "jht_sync_ab",
      last_used_at: iso(Date.now() - 16 * DAY),
      created_at: iso(Date.now() - 106 * DAY),
      expires_at: iso(Date.now() - 16 * DAY),
      client_version: null,
      client_platform: null,
      client_capabilities: null,
      client_seen_at: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tokens: [expired] }), { status: 200 })));
    await act(async () => root.render(createElement(CloudTokensClient)));
    await settle();

    expect(container.textContent).toContain("No active tokens.");
    const section = container.querySelector('section[aria-labelledby="expired_tokens_title"]');
    expect(section?.textContent).toContain("Expired tokens: their box is disconnected");
    expect(section?.textContent).toContain("box-synthetic");
    const renew = [...(section?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Renew");
    expect(renew).toBeTruthy();
    await act(async () => {
      renew!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((container.querySelector("#token_name") as HTMLInputElement).value).toBe("box-synthetic");
  });
});
