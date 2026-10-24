/**
 * `jht reset` e la sessione LinkedIn salvata sul disco.
 *
 * Il profilo del browser per LinkedIn sta in `$JHT_HOME/secrets/linkedin-profile` (controllo delle
 * posizioni) e in `$JHT_HOME/.cache/linkedin/` (candidature) e contiene la sessione della persona. Il reset `creds` ("config + credentials + sessions") non lo toccava:
 * chi azzerava le credenziali si ritrovava la sessione sul disco. Ora `secrets/` e' nello
 * scope `creds` (e `full` cancella tutto `~/.jht`); lo scope `config` resta solo il config.
 *
 * Sintetico: una cartella temporanea come JHT_HOME, un file finto nel profilo.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(__dirname, "../../../cli");

function homeWithProfile() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jht-reset-secrets-"));
  fs.writeFileSync(path.join(home, "jht.config.json"), "{}\n");
  fs.mkdirSync(path.join(home, "credentials"));
  fs.mkdirSync(path.join(home, "secrets", "linkedin-profile"), { recursive: true });
  fs.writeFileSync(path.join(home, "secrets", "linkedin-profile", "Cookies"), "synthetic");
  fs.mkdirSync(path.join(home, ".cache", "linkedin", "profile"), { recursive: true });
  fs.writeFileSync(path.join(home, ".cache", "linkedin", "profile", "Cookies"), "synthetic");
  fs.mkdirSync(path.join(home, ".cache", "playwright"), { recursive: true });
  fs.mkdirSync(path.join(home, "workspace"));
  fs.writeFileSync(path.join(home, "workspace", "keep.txt"), "mine");
  return home;
}

function reset(home: string, scope: string) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      "import { Command } from 'commander'; import { registerResetCommand } from './src/commands/reset.js'; " +
      "const p = new Command(); registerResetCommand(p); " +
      `await p.parseAsync(['node','jht','reset','--scope','${scope}','--non-interactive','--confirm-reset']);`],
    { cwd: CLI, encoding: "utf-8", env: { ...process.env, JHT_HOME: home } },
  );
}

describe("jht reset e secrets/linkedin-profile", () => {
  it("lo scope creds cancella la sessione LinkedIn e lascia il workspace", () => {
    const home = homeWithProfile();
    try {
      const run = reset(home, "creds");
      expect(run.status).toBe(0);
      expect(fs.existsSync(path.join(home, "secrets"))).toBe(false);
      expect(fs.existsSync(path.join(home, ".cache", "linkedin"))).toBe(false);
      expect(fs.existsSync(path.join(home, ".cache", "playwright"))).toBe(true); // il resto della cache non e' sessione LinkedIn
      expect(fs.existsSync(path.join(home, "credentials"))).toBe(false);
      expect(fs.existsSync(path.join(home, "jht.config.json"))).toBe(false);
      expect(fs.readFileSync(path.join(home, "workspace", "keep.txt"), "utf-8")).toBe("mine");
      expect(run.stdout + run.stderr).toContain("~/.jht/secrets/");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("lo scope config tocca solo il config", () => {
    const home = homeWithProfile();
    try {
      const run = reset(home, "config");
      expect(run.status).toBe(0);
      expect(fs.existsSync(path.join(home, "jht.config.json"))).toBe(false);
      expect(fs.existsSync(path.join(home, "secrets", "linkedin-profile", "Cookies"))).toBe(true);
      expect(fs.existsSync(path.join(home, ".cache", "linkedin", "profile", "Cookies"))).toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("lo scope full cancella tutto, secrets compreso", () => {
    const home = homeWithProfile();
    try {
      const run = reset(home, "full");
      expect(run.status).toBe(0);
      expect(fs.existsSync(path.join(home, "secrets"))).toBe(false);
      expect(fs.existsSync(path.join(home, ".cache"))).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
