/**
 * `jht backup` and the providers' keys.
 *
 * The backup is written in the same home as the data it protects: a key copied
 * into it is a second place where the key lives, in clear. Now the copy nulls
 * every key that names a secret (api_key, token, password...), at any depth,
 * and says so; a restore keeps the keys in use; `jht backup scrub` cleans the
 * backups made before. Synthetic: a temporary folder as JHT_HOME, made-up keys.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  countPlainSecrets,
  mergeLiveSecrets,
  redactSecrets,
} from "../../../cli/src/lib/backup-secrets.js";

const CLI = path.resolve(__dirname, "../../../cli");
const KEYS = ["SYNTH-KEY-A", "SYNTH-KEY-B", "SYNTH-BOT", "SYNTH-SESSION", "SYNTH-PASS", "SYNTH-REFRESH"];

const CONFIG = {
  active_provider: "anthropic",
  providers: {
    anthropic: { api_key: KEYS[0], model: "m", nested: { refresh_token: KEYS[5] } },
    openai: { api_key: KEYS[1] },
  },
  channels: { telegram: { bot_token: KEYS[2], chat: 7 } },
  accounts: [{ session_token: KEYS[3], ok: 1 }, { password: KEYS[4], ok: 2 }],
  working_hours: { start: "08:00" },
};

function makeHome(config: unknown = CONFIG) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jht-backup-secrets-"));
  fs.writeFileSync(path.join(home, "jht.config.json"), typeof config === "string" ? config : JSON.stringify(config, null, 2));
  return home;
}

function jht(home: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      "import { Command } from 'commander'; import { registerBackupCommand } from './src/commands/backup.js'; " +
      "const p = new Command(); registerBackupCommand(p); " +
      `await p.parseAsync(['node','jht','backup',...${JSON.stringify(args)}]);`],
    { cwd: CLI, encoding: "utf-8", env: { ...process.env, JHT_HOME: home } },
  );
}

function everyByte(dir: string): string {
  let text = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) text += fs.readFileSync(path.join(entry.parentPath, entry.name), "utf-8");
  }
  return text;
}

function backups(home: string) {
  return fs.readdirSync(path.join(home, "backups")).filter((n) => n.startsWith("backup-")).sort();
}

describe("the copy", () => {
  it("a backup holds no key, anywhere, and keeps the rest of the file", () => {
    const home = makeHome();
    try {
      const run = jht(home, "create");
      expect(run.status).toBe(0);
      const saved = fs.readFileSync(path.join(home, "backups", backups(home)[0], "jht.config.json"), "utf-8");
      for (const key of KEYS) expect(everyByte(path.join(home, "backups"))).not.toContain(key);
      const config = JSON.parse(saved);
      expect(config.providers.anthropic).toEqual({ api_key: null, model: "m", nested: { refresh_token: null } });
      expect(config.providers.openai).toEqual({ api_key: null });
      expect(config.channels.telegram).toEqual({ bot_token: null, chat: 7 });
      expect(config.accounts).toEqual([{ session_token: null, ok: 1 }, { password: null, ok: 2 }]);
      expect(config.active_provider).toBe("anthropic");
      expect(config.working_hours).toEqual({ start: "08:00" });
      expect(run.stdout).toContain("Keys left out: 6");
      expect(fs.readFileSync(path.join(home, "jht.config.json"), "utf-8")).toContain(KEYS[0]); // the live file is untouched
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("the folder is private and so are the files", () => {
    const home = makeHome();
    try {
      jht(home, "create");
      const dir = path.join(home, "backups");
      const mode = (p: string) => fs.statSync(p).mode & 0o777;
      expect(mode(dir)).toBe(0o700);
      expect(mode(path.join(dir, backups(home)[0]))).toBe(0o700);
      expect(mode(path.join(dir, backups(home)[0], "jht.config.json"))).toBe(0o600);
      expect(mode(path.join(dir, backups(home)[0], "manifest.json"))).toBe(0o600);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("a file that is not JSON is left out and said, never copied as it is", () => {
    const home = makeHome("{ api_key: SYNTH-KEY-A, not json");
    try {
      const run = jht(home, "create");
      expect(run.status).toBe(0);
      expect(fs.existsSync(path.join(home, "backups", backups(home)[0], "jht.config.json"))).toBe(false);
      expect(everyByte(path.join(home, "backups"))).not.toContain("SYNTH-KEY-A");
      expect(run.stdout).toContain("Not saved (not readable as JSON): jht.config.json");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("the other JSON files of the list are cleaned the same way", () => {
    const home = makeHome();
    try {
      fs.writeFileSync(path.join(home, "tools-config.json"), JSON.stringify({ search: { api_key: "SYNTH-TOOL", on: true } }));
      jht(home, "create");
      const saved = JSON.parse(fs.readFileSync(path.join(home, "backups", backups(home)[0], "tools-config.json"), "utf-8"));
      expect(saved).toEqual({ search: { api_key: null, on: true } });
      expect(everyByte(path.join(home, "backups"))).not.toContain("SYNTH-TOOL");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("backups made before", () => {
  function oldBackup(home: string, name = "backup-2026-10-01T10-00-00") {
    const dir = path.join(home, "backups", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "jht.config.json"), JSON.stringify(CONFIG, null, 2), { mode: 0o644 });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ name, createdAt: "2026-10-01T10:00:00Z", files: 1 }));
    return dir;
  }

  it("list and create warn, naming the backup and the command", () => {
    const home = makeHome();
    try {
      oldBackup(home);
      const list = jht(home, "list");
      expect(list.stdout).toContain("Warning: 1 older backup holds 6 keys");
      expect(list.stdout).toContain("backup-2026-10-01T10-00-00");
      expect(list.stdout).toContain("jht backup scrub");
      expect(jht(home, "create").stdout).toContain("jht backup scrub");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("scrub removes the keys, once, and the warning goes away", () => {
    const home = makeHome();
    try {
      const dir = oldBackup(home);
      const run = jht(home, "scrub");
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("Cleaned 1 backup: 6 keys removed");
      expect(everyByte(path.join(home, "backups"))).not.toMatch(/SYNTH-/);
      expect(JSON.parse(fs.readFileSync(path.join(dir, "jht.config.json"), "utf-8")).working_hours).toEqual({ start: "08:00" });
      if (process.platform !== "win32") {
        expect(fs.statSync(path.join(dir, "jht.config.json")).mode & 0o777).toBe(0o600);
      }
      expect(jht(home, "scrub").stdout).toContain("No backup holds keys in clear");
      expect(jht(home, "list").stdout).not.toContain("Warning");
      expect(fs.readFileSync(path.join(home, "jht.config.json"), "utf-8")).toContain(KEYS[0]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("restore", () => {
  it("brings back the settings and keeps the keys in use now", () => {
    const home = makeHome();
    try {
      jht(home, "create");
      const name = backups(home)[0];
      const live = { ...CONFIG, active_provider: "openai", providers: { ...CONFIG.providers, openai: { api_key: "SYNTH-NEW-KEY" } } };
      fs.writeFileSync(path.join(home, "jht.config.json"), JSON.stringify(live));
      const run = jht(home, "restore", "--name", name);
      expect(run.status).toBe(0);
      const config = JSON.parse(fs.readFileSync(path.join(home, "jht.config.json"), "utf-8"));
      expect(config.active_provider).toBe("anthropic");               // from the backup
      expect(config.providers.openai.api_key).toBe("SYNTH-NEW-KEY");  // from the file in use
      expect(config.providers.anthropic.api_key).toBe(KEYS[0]);
      expect(config.accounts[1].password).toBe(KEYS[4]);               // inside a list
      expect(run.stdout).toContain("Keys kept from the current files: 6");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("with no file in use, the keys stay empty: nothing is invented", () => {
    const home = makeHome();
    try {
      jht(home, "create");
      const name = backups(home)[0];
      fs.rmSync(path.join(home, "jht.config.json"));
      expect(jht(home, "restore", "--name", name).status).toBe(0);
      const config = JSON.parse(fs.readFileSync(path.join(home, "jht.config.json"), "utf-8"));
      expect(config.providers.anthropic.api_key).toBeNull();
      expect(config.working_hours).toEqual({ start: "08:00" });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("the rule", () => {
  it("nulls by the key's name, at any depth, and counts what is left", () => {
    const value = { a: { Api_Key: "x", b: [{ secretValue: "y", keep: 1 }] }, password: "", token: null, n: 3 };
    expect(redactSecrets(value)).toEqual({ a: { Api_Key: null, b: [{ secretValue: null, keep: 1 }] }, password: null, token: null, n: 3 });
    expect(countPlainSecrets(value)).toBe(2); // empty and null do not count
    expect(countPlainSecrets(redactSecrets(value))).toBe(0);
  });

  it("a merge fills only what the copy left empty", () => {
    const merged = mergeLiveSecrets(
      { api_key: null, token: "from-backup", keep: "b", nested: { password: null }, list: [{ api_key: null }] },
      { api_key: "live-1", token: "live-2", keep: "l", nested: { password: "live-3" }, list: [{ api_key: "live-4" }] },
    );
    expect(merged).toEqual({ api_key: "live-1", token: "from-backup", keep: "b", nested: { password: "live-3" }, list: [{ api_key: "live-4" }] });
  });
});
