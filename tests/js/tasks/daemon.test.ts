/** Test unitari — shared/daemon (vitest): install/uninstall scripts, plist, systemd, platform. */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const DAEMON_DIR = path.resolve(__dirname, "../../../shared/daemon");
const INSTALL = path.join(DAEMON_DIR, "install.sh");
const UNINSTALL = path.join(DAEMON_DIR, "uninstall.sh");
const installSrc = readFileSync(INSTALL, "utf-8");
const uninstallSrc = readFileSync(UNINSTALL, "utf-8");

function run(cmd: string): { code: number; out: string } {
  try {
    const out = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

// --- install.sh ---

describe("install.sh — argument parsing", () => {
  it("--help esce con codice 0 e mostra usage", () => {
    const r = run(`bash "${INSTALL}" --help`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--name");
    expect(r.out).toContain("--cmd");
  });

  it("senza --name esce con errore", () => {
    const r = run(`bash "${INSTALL}" --cmd "echo test"`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--name obbligatorio");
  });

  it("senza --cmd esce con errore", () => {
    const r = run(`bash "${INSTALL}" --name test-svc`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--cmd obbligatorio");
  });

  it("opzione sconosciuta esce con errore", () => {
    const r = run(`bash "${INSTALL}" --unknown-flag`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Opzione sconosciuta");
  });
});

describe("install.sh — template plist macOS", () => {
  it("contiene template plist con Label, RunAtLoad, KeepAlive", () => {
    expect(installSrc).toContain("<key>Label</key>");
    expect(installSrc).toContain("<key>RunAtLoad</key>");
    expect(installSrc).toContain("<key>KeepAlive</key>");
    expect(installSrc).toContain("<true/>");
  });

  it("plist usa ProgramArguments con /bin/bash -c", () => {
    expect(installSrc).toContain("<key>ProgramArguments</key>");
    expect(installSrc).toContain("<string>/bin/bash</string>");
    expect(installSrc).toContain("<string>-c</string>");
  });

  it("plist configura StandardOutPath e StandardErrorPath", () => {
    expect(installSrc).toContain("<key>StandardOutPath</key>");
    expect(installSrc).toContain("<key>StandardErrorPath</key>");
  });

  it("plist usa label com.jht.SERVICE_NAME", () => {
    expect(installSrc).toContain('com.jht.${SERVICE_NAME}');
  });

  it("plist include EnvironmentVariables se EXTRA_ENV non vuoto", () => {
    expect(installSrc).toContain("<key>EnvironmentVariables</key>");
    expect(installSrc).toContain("EXTRA_ENV");
  });
});

describe("install.sh — template systemd Linux", () => {
  it("contiene unit systemd con sezioni Unit/Service/Install", () => {
    expect(installSrc).toContain("[Unit]");
    expect(installSrc).toContain("[Service]");
    expect(installSrc).toContain("[Install]");
  });

  it("systemd usa Restart=always e RestartSec", () => {
    expect(installSrc).toContain("Restart=always");
    expect(installSrc).toContain("RestartSec=5");
  });

  it("systemd dipende da network-online.target", () => {
    expect(installSrc).toContain("After=network-online.target");
    expect(installSrc).toContain("Wants=network-online.target");
  });

  it("systemd WantedBy=default.target per servizio utente", () => {
    expect(installSrc).toContain("WantedBy=default.target");
  });
});

describe("install.sh — platform detection", () => {
  it("dispatch per Darwin e Linux con fallback errore", () => {
    expect(installSrc).toContain('Darwin) install_macos');
    expect(installSrc).toContain('Linux)  install_linux');
    expect(installSrc).toContain("Sistema operativo non supportato");
  });
});

// --- uninstall.sh ---

describe("uninstall.sh — argument parsing", () => {
  it("--help esce con codice 0 e mostra usage", () => {
    const r = run(`bash "${UNINSTALL}" --help`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--name");
    expect(r.out).toContain("--purge-logs");
  });

  it("senza --name esce con errore", () => {
    const r = run(`bash "${UNINSTALL}"`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("--name obbligatorio");
  });

  it("opzione sconosciuta esce con errore", () => {
    const r = run(`bash "${UNINSTALL}" --bad`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Opzione sconosciuta");
  });
});

describe("uninstall.sh — struttura e pulizia", () => {
  it("dispatch per Darwin e Linux con fallback errore", () => {
    expect(uninstallSrc).toContain('Darwin) uninstall_macos');
    expect(uninstallSrc).toContain('Linux)  uninstall_linux');
    expect(uninstallSrc).toContain("Sistema operativo non supportato");
  });

  it("macOS sposta plist nel Cestino come fallback sicuro", () => {
    expect(uninstallSrc).toContain(".Trash");
    expect(uninstallSrc).toContain('mv "$plist_path"');
  });

  it("Linux esegue daemon-reload dopo rimozione unit", () => {
    expect(uninstallSrc).toContain("systemctl --user daemon-reload");
  });

  it("--purge-logs elimina i file .log e .err.log", () => {
    expect(uninstallSrc).toContain("PURGE_LOGS");
    expect(uninstallSrc).toContain("${SERVICE_NAME}.log");
    expect(uninstallSrc).toContain("${SERVICE_NAME}.err.log");
  });

  it("entrambi gli script usano set -euo pipefail", () => {
    expect(installSrc).toContain("set -euo pipefail");
    expect(uninstallSrc).toContain("set -euo pipefail");
  });
});
