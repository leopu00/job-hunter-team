import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");

describe("runtime chat realtime contract", () => {
  it("il ritorno usa filesystem wake con paracadute lento", () => {
    const source = readFileSync(resolve(root, "cli/src/commands/cloud.js"), "utf-8");
    expect(source).toContain("watch(dir, { persistent: false }");
    expect(source).toContain("runChatSync('file', latestChatState)");
    expect(source).toContain("JHT_CHAT_LOCAL_SEC || '60'");
  });

  it("il browser fa catch-up solo alla (ri)sottoscrizione, non polling", () => {
    const source = readFileSync(
      resolve(root, "web/app/hooks/usePendingMessagesLive.ts"),
      "utf-8",
    );
    expect(source).toContain('status !== "SUBSCRIBED"');
    expect(source).toContain('fetch("/api/pending-messages"');
    expect(source).not.toContain("setInterval(");
  });
});
