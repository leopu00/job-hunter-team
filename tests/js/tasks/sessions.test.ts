/** Test vitest shared/sessions/ — SessionRegistry CRUD, TTL, state transitions, lifecycle. */
import { describe, it, expect } from "vitest";
import { SessionRegistry } from "../../../shared/sessions/registry.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function newReg() {
  const p = path.join(os.tmpdir(), `jht-sess-${randomUUID()}.json`);
  fs.writeFileSync(p, JSON.stringify({ version: 1, sessions: [] }));
  return new SessionRegistry({ storePath: p });
}

describe("SessionRegistry CRUD", () => {
  it("create → sessione attiva con UUID", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    expect(s.state).toBe("active");
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(s.channelId).toBe("web");
    expect(s.messageCount).toBe(0);
  });
  it("create con label, provider, model", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "cli", label: "Test", provider: "openai", model: "gpt-4o" });
    expect(s.label).toBe("Test");
    expect(s.provider).toBe("openai");
    expect(s.model).toBe("gpt-4o");
  });
  it("get → trova per id", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    expect((await reg.get(s.id))?.id).toBe(s.id);
  });
  it("get id sconosciuto → undefined", async () => {
    const reg = newReg();
    expect(await reg.get("non-esiste")).toBeUndefined();
  });
  it("list → contiene tutte le sessioni create", async () => {
    const reg = newReg();
    await reg.create({ channelId: "web" });
    await reg.create({ channelId: "cli" });
    const list = await reg.list();
    expect(list.length).toBe(2);
  });
  it("list channelId filter", async () => {
    const reg = newReg();
    await reg.create({ channelId: "web" });
    await reg.create({ channelId: "cli" });
    await reg.create({ channelId: "web" });
    const list = await reg.list({ channelId: "web" });
    expect(list.length).toBe(2);
    for (const s of list) expect(s.channelId).toBe("web");
  });
  it("list activeOnly filter", async () => {
    const reg = newReg();
    const s1 = await reg.create({ channelId: "web" });
    await reg.create({ channelId: "web" });
    await reg.pause(s1.id);
    expect((await reg.list({ activeOnly: true })).length).toBe(1);
  });
  it("update → patcha e ritorna sessione", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web", label: "old" });
    const up = await reg.update(s.id, { label: "new", provider: "claude" });
    expect(up?.label).toBe("new");
    expect(up?.provider).toBe("claude");
  });
  it("update id sconosciuto → null", async () => {
    const reg = newReg();
    expect(await reg.update("nope", { label: "x" })).toBeNull();
  });
  it("remove → true, poi get → undefined", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    expect(await reg.remove(s.id)).toBe(true);
    expect(await reg.get(s.id)).toBeUndefined();
  });
  it("remove id sconosciuto → false", async () => {
    const reg = newReg();
    expect(await reg.remove("nope")).toBe(false);
  });
});

describe("SessionRegistry state transitions", () => {
  it("pause active → true, state paused", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    expect(await reg.pause(s.id)).toBe(true);
    expect((await reg.get(s.id))?.state).toBe("paused");
  });
  it("pause non-active → false", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    await reg.pause(s.id);
    expect(await reg.pause(s.id)).toBe(false);
  });
  it("resume paused → true, state active", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    await reg.pause(s.id);
    expect(await reg.resume(s.id)).toBe(true);
    expect((await reg.get(s.id))?.state).toBe("active");
  });
  it("resume non-paused → false", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    expect(await reg.resume(s.id)).toBe(false);
  });
  it("end → true, state ended", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    expect(await reg.end(s.id)).toBe(true);
    expect((await reg.get(s.id))?.state).toBe("ended");
  });
  it("end già ended → false", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    await reg.end(s.id);
    expect(await reg.end(s.id)).toBe(false);
  });
});

describe("SessionRegistry messages e TTL", () => {
  it("addMessage → incrementa count", async () => {
    const reg = newReg();
    const s = await reg.create({ channelId: "web" });
    expect(await reg.addMessage(s.id, { role: "user", text: "ciao" })).toBe(true);
    expect(await reg.addMessage(s.id, { role: "assistant", text: "hey" })).toBe(true);
    expect((await reg.get(s.id))?.messageCount).toBe(2);
  });
  it("addMessage id sconosciuto → false", async () => {
    const reg = newReg();
    expect(await reg.addMessage("nope", { role: "user", text: "x" })).toBe(false);
  });
  it("prune rimuove sessioni ended vecchie", async () => {
    const reg = newReg();
    const s1 = await reg.create({ channelId: "web" });
    const s2 = await reg.create({ channelId: "web" });
    await reg.end(s1.id);
    const found = await reg.get(s1.id);
    if (found) found.updatedAtMs = Date.now() - 999_999_999;
    expect(await reg.prune(1000)).toBe(1);
    expect(await reg.get(s1.id)).toBeUndefined();
    expect(await reg.get(s2.id)).toBeDefined();
  });
  it("status → conteggi corretti", async () => {
    const reg = newReg();
    const s1 = await reg.create({ channelId: "web" });
    const s2 = await reg.create({ channelId: "web" });
    await reg.pause(s1.id);
    await reg.end(s2.id);
    await reg.create({ channelId: "web" });
    const st = await reg.status();
    expect(st.total).toBe(3);
    expect(st.active).toBe(1);
    expect(st.paused).toBe(1);
    expect(st.ended).toBe(1);
  });
});
