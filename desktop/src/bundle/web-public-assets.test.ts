// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { WEB_PUBLIC_FILES, webPublicAssets } from "./web-public-assets";

const web = (path: string) => fileURLToPath(new URL(`../../../web/${path}`, import.meta.url));

describe("the web's public files the desktop serves", () => {
  it("are the chat portraits web/lib/message-display.ts points at", () => {
    const source = readFileSync(web("lib/message-display.ts"), "utf8");
    const avatars = [...source.matchAll(/avatar:\s*"\/([^"]+)"/g)].map((m) => m[1]);
    expect(avatars.length).toBeGreaterThan(0);
    expect(new Set(WEB_PUBLIC_FILES)).toEqual(new Set(avatars));
  });

  it("are served at their web path in dev, as images", () => {
    const plugin = webPublicAssets();
    let middleware: (req: { url?: string }, res: unknown, next: () => void) => void = () => {};
    const server = { middlewares: { use: (fn: typeof middleware) => (middleware = fn) } };
    (plugin.configureServer as (s: unknown) => void)(server);

    const res = { setHeader: vi.fn(), end: vi.fn() };
    const next = vi.fn();
    middleware({ url: "/agents/mentor.png?v=1" }, res, next);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(res.end).toHaveBeenCalledWith(readFileSync(web("public/agents/mentor.png")));
    expect(next).not.toHaveBeenCalled();

    middleware({ url: "/dashboard.html" }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
