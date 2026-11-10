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

function reset(home: string, scope: string, deps?: string) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "-e",
      "import { Command } from 'commander'; import { registerResetCommand } from './src/commands/reset.js'; " +
      "const p = new Command(); registerResetCommand(p); " +
      `await p.parseAsync(['node','jht','reset','--scope','${scope}','--non-interactive','--confirm-reset']);`],
    { cwd: CLI, encoding: "utf-8", env: { ...process.env, JHT_HOME: home, ...(deps ? { JHT_DEPS_PREFIX: deps } : {}) } },
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

  // The keys of glm and kimi that `jht setup` keeps live on the container's volume (JHT_DEPS_PREFIX/keys), not in ~/.jht.
  function homeWithStoredKey() {
    const home = homeWithProfile();
    const deps = fs.mkdtempSync(path.join(os.tmpdir(), "jht-reset-deps-"));
    fs.mkdirSync(path.join(deps, "keys"), { mode: 0o700 });
    fs.writeFileSync(path.join(deps, "keys", "glm.key"), "synthetic-key-not-real\n", { mode: 0o600 });
    fs.mkdirSync(path.join(deps, "npm-global"));
    return { home, deps };
  }

  it("lo scope creds e lo scope full cancellano anche le chiavi tenute dal setup, e solo quelle (non il resto del volume)", () => {
    for (const scope of ["creds", "full"]) {
      const { home, deps } = homeWithStoredKey();
      try {
        const run = reset(home, scope, deps);
        expect(run.status).toBe(0);
        expect(fs.existsSync(path.join(deps, "keys"))).toBe(false);
        expect(fs.existsSync(path.join(deps, "npm-global"))).toBe(true);
        expect(run.stdout + run.stderr).toContain("API keys kept by the setup");
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(deps, { recursive: true, force: true });
      }
    }
  });

  it("lo scope config lascia le chiavi dov'erano", () => {
    const { home, deps } = homeWithStoredKey();
    try {
      expect(reset(home, "config", deps).status).toBe(0);
      expect(fs.readFileSync(path.join(deps, "keys", "glm.key"), "utf-8")).toBe("synthetic-key-not-real\n");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(deps, { recursive: true, force: true });
    }
  });
});
