import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TurnAccount } from "../src/core/agent-loop.ts";
import { connectMcpServers, mcpToolName, type McpConnection } from "../src/tools/mcp.ts";

const CONTEXT = { account: new TurnAccount(Date.now), remainingMs: () => 60_000 };
const fixture = fileURLToPath(new URL("./fixtures/mcp-server.ts", import.meta.url));

let connection: McpConnection;

beforeAll(async () => {
  process.env["JHT_API_TEST_MCP_SECRET_KEY"] = "leak";
  connection = await connectMcpServers({
    fixture: { command: process.execPath, args: ["--experimental-strip-types", "--no-warnings", fixture], env: { GIVEN: "yes" } },
    broken: { command: "/nonexistent/mcp-server" },
  });
}, 30_000);

afterAll(async () => {
  delete process.env["JHT_API_TEST_MCP_SECRET_KEY"];
  await connection.close();
});

const tool = (name: string) => connection.tools.find((t) => t.spec.name === name)!;

describe("MCP client", () => {
  it("registers each server tool under a namespaced name and reports failed servers", () => {
    expect(connection.tools.map((t) => t.spec.name)).toEqual(["mcp__fixture__add", "mcp__fixture__fail", "mcp__fixture__env"]);
    expect(connection.servers[0]).toEqual({ name: "fixture", toolCount: 3 });
    expect(connection.servers[1]).toMatchObject({ name: "broken", toolCount: 0 });
    expect(connection.servers[1]?.error).toBeTruthy();
    expect(tool("mcp__fixture__add").spec.description).toBe('[MCP server "fixture"] Adds two numbers.');
  });

  it("validates arguments against the server's schema and calls the tool", async () => {
    const add = tool("mcp__fixture__add");
    expect(add.spec.schema.safeParse({ a: "one", b: 2 }).success).toBe(false);
    expect(await add.execute(add.spec.schema.parse({ a: 2, b: 3 }), CONTEXT)).toEqual({ ok: true, content: "5" });
  });

  it("marks a tool error as failed", async () => {
    const fail = tool("mcp__fixture__fail");
    expect(await fail.execute({}, CONTEXT)).toEqual({ ok: false, content: "it broke" });
  });

  it("starts servers with the env the config names, not the runtime's secrets", async () => {
    const env = tool("mcp__fixture__env");
    expect((await env.execute({ name: "GIVEN" }, CONTEXT)).content).toBe("set");
    expect((await env.execute({ name: "JHT_API_TEST_MCP_SECRET_KEY" }, CONTEXT)).content).toBe("unset");
  });

  it("classifies every MCP call as execute", () => {
    expect(tool("mcp__fixture__add").classify({ a: 1, b: 2 })).toEqual({
      risk: "execute",
      paths: [],
      summary: 'fixture.add {"a":1,"b":2}',
    });
  });

  it("builds names providers accept", () => {
    expect(mcpToolName("my server", "do.thing")).toBe("mcp__my_server__do_thing");
    expect(mcpToolName("s", "x".repeat(100))).toHaveLength(64);
  });
});
