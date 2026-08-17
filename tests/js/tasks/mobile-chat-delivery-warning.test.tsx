import { createRequire } from "node:module";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  MobileChatDeliveryWarning,
  mobileChatDeliveryAlert,
  type TeamState,
} from "@/app/(protected)/team/MobileTeamStatus";
import type { Locale } from "@/i18n/config";

const REPO = path.resolve(__dirname, "../../..");
const webRequire = createRequire(path.join(REPO, "web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

const LOCALES: Locale[] = ["en", "it", "hu", "es", "de", "fr", "pt"];
const COPY: Record<Locale, string> = {
  en: "Some messages you sent may not have reached the team yet.",
  it: "Alcuni messaggi che hai inviato potrebbero non essere ancora arrivati al team.",
  hu: "Előfordulhat, hogy néhány elküldött üzeneted még nem érkezett meg a csapathoz.",
  es: "Es posible que algunos mensajes que enviaste aún no hayan llegado al equipo.",
  de: "Einige deiner gesendeten Nachrichten haben das Team möglicherweise noch nicht erreicht.",
  fr: "Certains messages que vous avez envoyés ne sont peut-être pas encore parvenus à l'équipe.",
  pt: "Algumas mensagens que enviou poderão ainda não ter chegado à equipa.",
};

function teamState(lastError: string | null): TeamState {
  return {
    should_run: true,
    is_running: true,
    last_heartbeat_at: "2026-08-12T18:30:00.000Z",
    last_action: null,
    last_action_at: null,
    last_error: lastError,
    last_error_at: "2026-08-12T18:31:00.000Z",
    emergency_stop_requested_at: null,
    emergency_stop_completed_at: null,
  };
}

function renderWarning(state: TeamState, locale: Locale = "en") {
  return renderToStaticMarkup(
    createElement(MobileChatDeliveryWarning, { state, locale }),
  );
}

describe("MobileTeamStatus — chat delivery warning", () => {
  it("shows sanitized copy and a timestamp for every supported locale", () => {
    const state = teamState("chat: 2 user turns not delivered to the agent");

    for (const locale of LOCALES) {
      const html = renderWarning(state, locale);
      const text = new JSDOM(html).window.document.body.textContent ?? "";
      expect(html).toContain("data-chat-delivery-warning");
      expect(text).toContain(COPY[locale]);
      expect(html).toContain('dateTime="2026-08-12T18:31:00.000Z"');
    }
    expect(new Set(Object.values(COPY)).size).toBe(LOCALES.length);
  });

  it("never exposes message bodies or infrastructure details", () => {
    const raw =
      "chat: failed to read user turns from the cloud (HTTP 401 synthetic-transport-detail)";
    const html = renderWarning(teamState(raw));

    expect(html).toContain(COPY.en);
    expect(html).not.toContain(raw);
    expect(html).not.toContain("HTTP 401");
    expect(html).not.toContain("synthetic-transport-detail");
  });

  it("disappears on recovery and ignores unrelated team errors", () => {
    const recovered = teamState(null);
    expect(mobileChatDeliveryAlert(recovered)).toBeNull();
    expect(renderWarning(recovered)).toBe("");

    const unrelated = teamState("provider: synthetic runtime unavailable");
    expect(mobileChatDeliveryAlert(unrelated)).toBeNull();
    expect(renderWarning(unrelated)).toBe("");
  });

  it("fails closed when the chat classification has no valid timestamp", () => {
    const state = teamState("chat: 1 user turns not delivered to the agent");
    state.last_error_at = "invalid";
    expect(mobileChatDeliveryAlert(state)).toBeNull();
    expect(renderWarning(state)).toBe("");
  });
});
