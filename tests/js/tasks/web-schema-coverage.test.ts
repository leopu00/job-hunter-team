import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const GATE = path.join(ROOT, "scripts/check-web-schema-coverage.mjs");
const tempRoots: string[] = [];

type ReceiptEntry = { receipts: string[] } | { exception: string };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jht-schema-coverage-"));
  tempRoots.push(root);
  const sourceRoot = path.join(root, "web");
  fs.mkdirSync(path.join(sourceRoot, "app"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, "app/query.ts"),
    [
      "const supabase = {} as any;",
      'supabase.from("positions").select("id").eq("user_id", "fixture");',
      'supabase.rpc("known_rpc", {});',
    ].join("\n"),
  );

  const canaryPath = path.join(root, "canary.json");
  const canary = {
    contract_id: "fixture-contract",
    expected_checks: ["fixture.columns", "fixture.rpc"],
  };
  const canaryRaw = `${JSON.stringify(canary, null, 2)}\n`;
  fs.writeFileSync(canaryPath, canaryRaw);

  const coveragePath = path.join(root, "coverage.json");
  const coverage = {
    schema_version: 1,
    source_roots: ["web/app", "web/lib"],
    canary: {
      path: path.relative(ROOT, canaryPath).replaceAll(path.sep, "/"),
      sha256: hash(canaryRaw),
      contract_id: "fixture-contract",
    },
    coverage: {
      rpcs: {
        known_rpc: { receipts: ["fixture.rpc"] } as ReceiptEntry,
      },
      tables: {
        positions: { receipts: ["fixture.columns"] } as ReceiptEntry,
      },
      columns: {
        "positions.id": { receipts: ["fixture.columns"] } as ReceiptEntry,
        "positions.user_id": {
          receipts: ["fixture.columns"],
        } as ReceiptEntry,
      },
      ambiguous_sites: {} as Record<string, ReceiptEntry>,
    },
  };

  function writeCoverage() {
    fs.writeFileSync(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`);
  }
  writeCoverage();

  function run() {
    return spawnSync(
      process.execPath,
      [
        GATE,
        "--coverage",
        coveragePath,
        "--canary",
        canaryPath,
        "--source-root",
        sourceRoot,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
  }

  return {
    root,
    sourceRoot,
    canaryPath,
    coverage,
    writeCoverage,
    run,
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("web code → live-schema receipt coverage", () => {
  it("passes the checked-in deterministic census without credentials", () => {
    const env = { PATH: process.env.PATH ?? "" };
    const first = execFileSync(process.execPath, [GATE], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });
    const second = execFileSync(process.execPath, [GATE], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });
    expect(first).toBe(second);
    expect(first).toMatch(
      // 40 → 42 con la ricevuta 078-086.web.v6, che aggiunge le due RPC
      // dell'esito (#187). Il pin è sul CONTEGGIO e non su `\d+` di proposito:
      // deve muoversi solo quando qualcuno emette una ricevuta nuova e lo
      // dichiara, non ogni volta che il censimento cambia da sé.
      /^WEB-SCHEMA-COVERAGE PASS rpcs=\d+ tables=\d+ columns=\d+ ambiguous=\d+ receipts=42\n$/,
    );
  });

  it("accepts a target fixture only when every symbol maps to a receipt", () => {
    const target = fixture();
    const result = target.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "WEB-SCHEMA-COVERAGE PASS rpcs=1 tables=1 columns=2 ambiguous=0 receipts=2",
    );
    expect(result.stderr).toBe("");
  });

  it("fails closed on a new RPC", () => {
    const target = fixture();
    fs.writeFileSync(
      path.join(target.sourceRoot, "lib/new-rpc.ts"),
      'const supabase = {} as any; supabase.rpc("new_rpc", {});\n',
    );
    const result = target.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("WEB-SCHEMA-COVERAGE FAIL code=rpc_uncovered\n");
  });

  it("fails closed on a new column even when the table is already covered", () => {
    const target = fixture();
    fs.appendFileSync(
      path.join(target.sourceRoot, "app/query.ts"),
      '\nsupabase.from("positions").select("new_column");\n',
    );
    const result = target.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "WEB-SCHEMA-COVERAGE FAIL code=column_uncovered\n",
    );
  });

  it("fails closed on a new table even when no column method follows", () => {
    const target = fixture();
    fs.appendFileSync(
      path.join(target.sourceRoot, "app/query.ts"),
      '\nsupabase.from("new_table").delete();\n',
    );
    const result = target.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "WEB-SCHEMA-COVERAGE FAIL code=table_uncovered\n",
    );
  });

  it.each(["insert", "update", "upsert"])(
    "censuses columns in a detached %s builder",
    (method) => {
      const target = fixture();
      fs.appendFileSync(
        path.join(target.sourceRoot, "app/query.ts"),
        `\nconst detached = supabase.from("positions"); ` +
          `detached.${method}({ totally_new_unreceipted_column: "x" });\n`,
      );
      const result = target.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "WEB-SCHEMA-COVERAGE FAIL code=column_uncovered\n",
      );
    },
  );

  it("fails closed on a dynamic table alias", () => {
    const target = fixture();
    fs.appendFileSync(
      path.join(target.sourceRoot, "app/query.ts"),
      '\nconst TABLE = "positions"; supabase.from(TABLE).select("id");\n',
    );
    const result = target.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "WEB-SCHEMA-COVERAGE FAIL code=ambiguous_uncovered\n",
    );
  });

  it("invalidates a reviewed dynamic alias when its source drifts", () => {
    const target = fixture();
    const queryPath = path.join(target.sourceRoot, "app/query.ts");
    fs.appendFileSync(
      queryPath,
      '\nconst TABLE = "positions"; supabase.from(TABLE).select("id");\n',
    );
    const inventory = JSON.parse(
      execFileSync(
        process.execPath,
        [GATE, "--inventory", "--source-root", target.sourceRoot],
        { cwd: ROOT, encoding: "utf8" },
      ),
    ) as { ambiguous_sites: string[] };
    expect(inventory.ambiguous_sites).toHaveLength(1);
    target.coverage.coverage.ambiguous_sites[inventory.ambiguous_sites[0]] = {
      exception: "reviewed_dynamic_schema_use",
    };
    target.writeCoverage();
    expect(target.run().status).toBe(0);

    fs.appendFileSync(queryPath, "// causal drift\n");
    const result = target.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "WEB-SCHEMA-COVERAGE FAIL code=ambiguous_uncovered\n",
    );
  });

  it("fails when a mapped receipt disappears from the canary", () => {
    const target = fixture();
    const canaryRaw = `${JSON.stringify(
      { contract_id: "fixture-contract", expected_checks: ["fixture.columns"] },
      null,
      2,
    )}\n`;
    fs.writeFileSync(target.canaryPath, canaryRaw);
    target.coverage.canary.sha256 = hash(canaryRaw);
    target.writeCoverage();
    const result = target.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "WEB-SCHEMA-COVERAGE FAIL code=receipt_missing\n",
    );
  });

  it("rejects schema_version=true instead of accepting it as 1", () => {
    const target = fixture();
    target.coverage.schema_version = true as unknown as number;
    target.writeCoverage();
    const result = target.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "WEB-SCHEMA-COVERAGE FAIL code=coverage_malformed\n",
    );
  });

  it("reports finite codes without source, payload, path, or environment", () => {
    const target = fixture();
    const privateMarker = "PRIVATE_MARKER_DO_NOT_PRINT";
    fs.appendFileSync(
      path.join(target.sourceRoot, "app/query.ts"),
      `\nsupabase.rpc(${JSON.stringify(privateMarker)}, {});\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        GATE,
        "--coverage",
        path.join(target.root, "missing-coverage.json"),
        "--canary",
        target.canaryPath,
        "--source-root",
        target.sourceRoot,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", PRIVATE_VALUE: privateMarker },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "WEB-SCHEMA-COVERAGE FAIL code=input_unreadable\n",
    );
    expect(result.stderr).not.toContain(privateMarker);
    expect(result.stderr).not.toContain(target.root);
  });
});
