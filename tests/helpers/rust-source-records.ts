import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type RustSourceRecord = {
  logical_module: string;
  relative: string;
  source: string;
  code: string;
  original_source: string;
  original_code: string;
  offset_units: "utf16";
};

type ReadOptions = { python?: string; includeTests?: boolean };
type Mode = "compiled" | "entrypoint";

const HELPER_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const RECORD_FIELDS = [
  "logical_module", "relative", "source", "code",
  "original_source", "original_code", "offset_units",
];
const TRANSPORT = `
import json
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from rust_source_guard import compiled_records, entrypoint_records
reader = {"compiled": compiled_records, "entrypoint": entrypoint_records}[sys.argv[4]]
records = reader(sys.argv[3], root=Path(sys.argv[2]), include_tests=sys.argv[5] == "true")
print(json.dumps([record.to_wire() for record in records]))
`;

function decodeRecords(stdout: string): RustSourceRecord[] {
  const value: unknown = JSON.parse(stdout);
  if (!Array.isArray(value) || value.length === 0) throw new Error("Rust acquisition returned no records");
  for (const record of value) {
    if (!record || typeof record !== "object" || Array.isArray(record)
      || Object.keys(record).length !== RECORD_FIELDS.length
      || RECORD_FIELDS.some((field) => !Object.hasOwn(record, field) || typeof record[field] !== "string")) {
      throw new Error("Invalid canonical Rust record fields");
    }
    if (record.offset_units !== "utf16" || record.source.length !== record.code.length
      || record.original_source.length !== record.original_code.length) {
      throw new Error("Canonical Rust masks must use matching UTF-16 offsets");
    }
    if (!record.relative || record.relative.startsWith("/") || record.relative.includes("\\")
      || record.relative.split("/").some((part: string) => part === ".." || part === "." || part === "")) {
      throw new Error("Canonical Rust record has no relative source path");
    }
  }
  return value as RustSourceRecord[];
}

function readRecords(root: string, entry: string, mode: Mode, options: ReadOptions): RustSourceRecord[] {
  const result = spawnSync(options.python ?? "python3", [
    "-I", "-B", "-c", TRANSPORT, HELPER_DIRECTORY, root, entry, mode, String(options.includeTests ?? false),
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new Error(`Cannot acquire Rust ${mode} entry ${entry}`, { cause: result.error });
  if (result.status !== 0) {
    const status = result.status ?? result.signal;
    throw new Error(`Rust ${mode} acquisition failed for ${entry} (${status}): ${result.stderr.trim()}`);
  }
  return decodeRecords(result.stdout);
}

/** Uses the canonical library graph; a physical orphan never becomes a fallback. */
export function compiledRustRecords(root: string, entry = "lib.rs", options: ReadOptions = {}): RustSourceRecord[] {
  return readRecords(root, entry, "compiled", options);
}

/** Explicit target for an inventoried standalone executable or execution harness. */
export function entrypointRustRecords(root: string, entry: string, options: ReadOptions = {}): RustSourceRecord[] {
  return readRecords(root, entry, "entrypoint", options);
}
