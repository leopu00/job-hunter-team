import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryAuditSink, WriterApiWorker } from "../src/index.js";
import {
  providerDiagnostic,
  writeProviderDiagnostic,
} from "../src/providers/ai-sdk.js";
import { fixtureProfile, loadFixture } from "./helpers.js";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("privacy-safe diagnostics", () => {
  it("emits only allowlisted provider diagnostics", () => {
    const marker = "synthetic-sensitive-provider-message-123456";
    const error = Object.assign(new Error(`provider said ${marker}`), {
      name: `AttackerControlled-${marker}`,
      statusCode: 502,
      responseBody: marker,
    });

    expect(providerDiagnostic(error)).toEqual({
      category: "provider_http_error",
      statusCode: 502,
    });

    vi.stubEnv("JHT_SCOUT_PROVIDER_DEBUG", "1");
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    writeProviderDiagnostic(error);
    const output = String(write.mock.calls[0]?.[0]);
    expect(output).toContain('"category":"provider_http_error"');
    expect(output).not.toContain(marker);
    expect(output).not.toContain("message");
    expect(output).not.toContain("responseBody");
  });

  it("does not print the standalone database absolute path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "jht-cli-private-db-"));
    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", "src/standalone-cli.ts", "--workspace", workspace],
      { cwd: packageRoot },
    );
    const output = JSON.parse(stdout) as Record<string, unknown>;
    expect(output).not.toHaveProperty("databasePath");
    expect(stdout).not.toContain(workspace);
  }, 20_000);

  it("does not print the usage audit absolute path", async () => {
    const root = await mkdtemp(join(tmpdir(), "jht-cli-private-audit-"));
    const auditPath = join(root, "scout-runs.jsonl");
    await writeFile(auditPath, "", "utf8");
    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", "src/usage-report-cli.ts", "--audit", auditPath],
      { cwd: packageRoot },
    );
    const output = JSON.parse(stdout) as Record<string, unknown>;
    expect(output).not.toHaveProperty("auditPath");
    expect(stdout).not.toContain(auditPath);
  });

  it("never exposes raw provider errors or runtime paths from structured roles", async () => {
    const marker = "synthetic-structured-private-provider-message";
    const runtimeDir = await mkdtemp(join(tmpdir(), "jht-private-role-run-"));
    const envelope = (await loadFixture("prototype-inputs.synthetic.json")) as {
      sharedLimits: unknown;
      inputs: Record<string, Record<string, unknown>>;
    };
    const audit = new MemoryAuditSink();
    const outcome = await new WriterApiWorker(await fixtureProfile(), {
      runtimeDir,
      audit,
      adapter: {
        async run() {
          throw new Error(`provider leaked ${marker} from ${runtimeDir}`);
        },
      },
    }).run({
      ...envelope.inputs.writer,
      limits: envelope.sharedLimits,
    });
    const serialized = JSON.stringify({ outcome, audit: audit.events });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("INTERNAL_ERROR");
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain(runtimeDir);
    expect(serialized).not.toContain("provider leaked");
  });
});
