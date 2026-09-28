// @vitest-environment jsdom
//
// Canali Realtime del web su `team_state`: `useChatLaneLive` e
// `CloudRefreshButton`. Tre promesse per canale, ognuna con il suo test:
//
//   1. il canale chiede SOLO la riga dell'utente loggato (filtro
//      `user_id=eq.<uid>` sopra la RLS) e ha un topic suo per montaggio;
//   2. un payload che porta un altro user_id non fa niente (niente corsia
//      mossa, niente router.refresh) — la RLS non è l'unica difesa;
//   3. smontato mentre `setAuth` è in volo → nessun canale creato: la
//      cleanup è già passata e non lo rimuoverebbe più.
//
// Client Supabase finto: registra le opzioni di `.on("postgres_changes")`,
// consegna i payload a mano e può tenere `setAuth` sospeso.
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
  refresh: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => h.client }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: h.refresh }),
}));
vi.mock("@/lib/use-locale", () => ({ useLocale: () => "en" }));

import { useChatLaneLive } from "@/app/hooks/useChatLaneLive";
import CloudRefreshButton from "@/app/components/CloudRefreshButton";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement, act } = webRequire("react");
const { createRoot } = webRequire("react-dom/client");

// Identificativi sintetici: nessun utente reale.
const UID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

type Handler = (payload: Record<string, unknown>) => void;
type Channel = {
  topic: string;
  opts: Record<string, unknown> | null;
  handler: Handler | null;
};

function fakeSupabase(row: Record<string, unknown>, holdSetAuth = false) {
  const channels: Channel[] = [];
  let releaseSetAuth: () => void = () => {};
  const client = {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({ data: row, error: null }),
      }),
    }),
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "jwt-sintetico", user: { id: UID } } },
      }),
    },
    realtime: {
      setAuth: vi.fn(() =>
        holdSetAuth
          ? new Promise<void>((resolve) => {
              releaseSetAuth = resolve;
            })
          : Promise.resolve(),
      ),
    },
    channel: vi.fn((topic: string) => {
      const record: Channel = { topic, opts: null, handler: null };
      channels.push(record);
      const ch = {
        on: (_type: string, opts: Record<string, unknown>, cb: Handler) => {
          record.opts = opts;
          record.handler = cb;
          return ch;
        },
        subscribe: (cb?: (status: string) => void) => {
          cb?.("SUBSCRIBED");
          return ch;
        },
      };
      return ch;
    }),
    removeChannel: vi.fn(async () => "ok"),
  };
  h.client = client;
  return { client, channels, release: () => releaseSetAuth() };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mount(element: any) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(element));
  await flush();
  return { unmount: () => act(async () => root.unmount()) };
}

async function deliver(channel: Channel, payload: Record<string, unknown>) {
  await act(async () => channel.handler?.(payload));
}

afterEach(() => {
  vi.unstubAllGlobals();
  h.refresh.mockReset();
  h.client = null;
});

describe("useChatLaneLive — canale della corsia chat", () => {
  const T0 = "2026-01-01T00:00:00.000Z";
  const row = { user_id: UID, chat_requested_at: T0, chat_delivered_at: T0 };

  function Probe({ out }: { out: { lane: unknown } }) {
    out.lane = useChatLaneLive().lane;
    return null;
  }

  it("sottoscrive solo la riga dell'utente, con un topic per montaggio", async () => {
    const fake = fakeSupabase(row);
    const a = await mount(createElement(Probe, { out: { lane: null } }));
    const b = await mount(createElement(Probe, { out: { lane: null } }));

    expect(fake.channels).toHaveLength(2);
    for (const channel of fake.channels) {
      expect(channel.opts).toMatchObject({
        event: "UPDATE",
        schema: "public",
        table: "team_state",
        filter: `user_id=eq.${UID}`,
      });
    }
    expect(fake.channels[0].topic).not.toBe(fake.channels[1].topic);
    await a.unmount();
    await b.unmount();
  });

  it("un payload di un altro user_id non muove la corsia", async () => {
    const fake = fakeSupabase(row);
    const out: { lane: unknown } = { lane: null };
    const probe = await mount(createElement(Probe, { out }));
    expect(out.lane).toEqual({ requestedAt: T0, deliveredAt: T0 });
    const [channel] = fake.channels;

    const LATER = "2026-01-01T01:00:00.000Z";
    await deliver(channel, {
      new: { user_id: OTHER, chat_requested_at: LATER, chat_delivered_at: T0 },
    });
    await deliver(channel, {
      new: { user_id: UID, chat_requested_at: LATER, chat_delivered_at: T0 },
      old: { user_id: OTHER },
    });
    expect(out.lane).toEqual({ requestedAt: T0, deliveredAt: T0 });

    // Controllo positivo: la riga propria passa, quindi l'handler è vivo.
    await deliver(channel, {
      new: { user_id: UID, chat_requested_at: LATER, chat_delivered_at: T0 },
      old: { user_id: UID },
    });
    expect(out.lane).toEqual({ requestedAt: LATER, deliveredAt: T0 });
    await probe.unmount();
  });

  it("smontato durante setAuth: nessun canale creato", async () => {
    const fake = fakeSupabase(row, true);
    const probe = await mount(createElement(Probe, { out: { lane: null } }));
    expect(fake.client.realtime.setAuth).toHaveBeenCalledTimes(1);

    await probe.unmount();
    fake.release();
    await flush();

    expect(fake.client.channel).not.toHaveBeenCalled();
    expect(fake.client.removeChannel).not.toHaveBeenCalled();
  });
});

describe("CloudRefreshButton — canale dello stato di sync", () => {
  const T0 = "2026-01-01T00:00:00.000Z";
  const row = {
    user_id: UID,
    sync_requested_at: null,
    sync_completed_at: T0,
    last_action: null,
    last_action_at: null,
    cloud_push_status: "current",
    cloud_push_checked_at: T0,
  };

  function stubStatus() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ remote: true, logged_in: true })),
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  }

  it("sottoscrive solo la riga dell'utente, con un topic per montaggio", async () => {
    stubStatus();
    const fake = fakeSupabase(row);
    const a = await mount(createElement(CloudRefreshButton));
    const b = await mount(createElement(CloudRefreshButton));

    expect(fake.channels).toHaveLength(2);
    for (const channel of fake.channels) {
      expect(channel.opts).toMatchObject({
        event: "UPDATE",
        schema: "public",
        table: "team_state",
        filter: `user_id=eq.${UID}`,
      });
    }
    expect(fake.channels[0].topic).not.toBe(fake.channels[1].topic);
    await a.unmount();
    await b.unmount();
  });

  it("un payload di un altro user_id non ricarica i dati", async () => {
    stubStatus();
    const fake = fakeSupabase(row);
    const button = await mount(createElement(CloudRefreshButton));
    const [channel] = fake.channels;
    expect(channel).toBeDefined();

    await deliver(channel, {
      new: { ...row, user_id: OTHER, sync_completed_at: "2026-01-01T01:00:00Z" },
    });
    await deliver(channel, {
      new: { ...row, sync_completed_at: "2026-01-01T02:00:00Z" },
      old: { user_id: OTHER },
    });
    expect(h.refresh).not.toHaveBeenCalled();

    // Controllo positivo: un completamento nuovo sulla riga propria ricarica.
    await deliver(channel, {
      new: { ...row, sync_completed_at: "2026-01-01T03:00:00Z" },
      old: { user_id: UID },
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await button.unmount();
  });

  it("senza sessione: nessun canale, ma il catch-up iniziale gira lo stesso", async () => {
    stubStatus();
    const fake = fakeSupabase(row);
    fake.client.auth.getSession = async () =>
      ({ data: { session: null } }) as never;
    const from = vi.fn(fake.client.from);
    fake.client.from = from;
    const button = await mount(createElement(CloudRefreshButton));

    expect(fake.client.channel).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("team_state");
    await button.unmount();
  });

  it("smontato durante setAuth: nessun canale creato", async () => {
    stubStatus();
    const fake = fakeSupabase(row, true);
    const button = await mount(createElement(CloudRefreshButton));
    expect(fake.client.realtime.setAuth).toHaveBeenCalledTimes(1);

    await button.unmount();
    fake.release();
    await flush();

    expect(fake.client.channel).not.toHaveBeenCalled();
    expect(fake.client.removeChannel).not.toHaveBeenCalled();
  });
});
