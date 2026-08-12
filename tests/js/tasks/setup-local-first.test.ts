import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const read = (relative: string) =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

function activeDocumentation(): Array<[string, string]> {
  const docsRoot = path.join(ROOT, "docs");
  const files: Array<[string, string]> = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_archive") visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push([
          path.relative(ROOT, absolute),
          fs.readFileSync(absolute, "utf8"),
        ]);
      }
    }
  };
  visit(docsRoot);
  return files;
}

const LOCALES = ["en", "it", "hu", "es", "de", "fr", "pt"] as const;

const hostSetup = read("scripts/host-setup.sh");
const cliSetup = read("cli/wizard/setup.js");
const gameTour = read("game/scripts/dialogue/dialogues.gd");
const scriptedOnboarding = read("game/scripts/setup/scripted_onboarding.gd");
const landing = [
  read("web/app/components/landing/LandingI18n.tsx"),
  ...["de", "es", "fr", "pt"].map((locale) =>
    read(`web/app/components/landing/i18n/${locale}.ts`),
  ),
].join("\n");
const vpsRoute = read("web/app/docs/guides/run-on-a-vps/page.tsx");
const privacyRoute = read("web/app/privacy/page.tsx");
const setupGuide = read("web/app/setup-guide/guide-content.ts");
const chooseWhere = read("docs/guides/CHOOSE-WHERE-TO-RUN.md");

function runHostSetup(options: {
  display?: string;
  args?: string[];
}) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jht-host-setup-"));
  const bin = path.join(sandbox, "bin");
  const jhtHome = path.join(sandbox, "jht-home");
  fs.mkdirSync(bin);
  // Il kernel simulato rende il test identico su macOS e Linux. L'awk finto
  // dichiara swap già attivo: il ramo VPS resta una verifica senza effetti host.
  fs.writeFileSync(path.join(bin, "uname"), "#!/bin/sh\necho Linux\n", {
    mode: 0o700,
  });
  fs.writeFileSync(
    path.join(bin, "awk"),
    `#!/bin/sh
case "$1" in
  *MemTotal*) echo 4194304 ;;
  *SwapTotal*) echo 2097152 ;;
  *) exec /usr/bin/awk "$@" ;;
esac
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    JHT_HOME_HOST: jhtHome,
    JHT_LANG: "en",
    JHT_USER_TZ: "UTC",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
  if (options.display === undefined) {
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
  } else {
    env.DISPLAY = options.display;
    delete env.WAYLAND_DISPLAY;
  }
  try {
    const result = spawnSync(
      "bash",
      [path.join(ROOT, "scripts/host-setup.sh"), "--non-interactive", ...(options.args ?? [])],
      { env, encoding: "utf8" },
    );
    return {
      ...result,
      hostEnv: fs.readFileSync(path.join(jhtHome, "host.env"), "utf8"),
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

describe("CLI host wizard — local e VPS sono host reali", () => {
  it("conserva rilevamento, conferma e override senza un default inventato", () => {
    expect(hostSetup).toContain('HOST_TYPE="$DETECTED"');
    expect(hostSetup).toContain('HOST_TYPE="$FORCED_HOST_TYPE"');
    expect(hostSetup).toMatch(/1\) HOST_TYPE="local"/);
    expect(hostSetup).toMatch(/2\) HOST_TYPE="vps"/);
    expect(hostSetup.indexOf("host_setup.option.local.title")).toBeLessThan(
      hostSetup.indexOf("host_setup.option.vps.title"),
    );
  });

  it("rileva desktop e headless, mentre l'override esplicito resta autorevole", () => {
    const desktop = runHostSetup({ display: ":synthetic" });
    expect(desktop.status, desktop.stderr).toBe(0);
    expect(desktop.hostEnv).toContain("JHT_HOST_TYPE=local");

    const headless = runHostSetup({});
    expect(headless.status, headless.stderr).toBe(0);
    expect(headless.hostEnv).toContain("JHT_HOST_TYPE=vps");
    expect(headless.stdout).toContain("Swap already configured");

    const explicit = runHostSetup({ args: ["--host-type=local"] });
    expect(explicit.status, explicit.stderr).toBe(0);
    expect(explicit.hostEnv).toContain("JHT_HOST_TYPE=local");
  });

  it("non promette la dashboard locale ritirata o una dashboard esposta", () => {
    const lower = hostSetup.toLowerCase();
    expect(lower).not.toContain("the web dashboard opens automatically");
    expect(lower).not.toContain("expose the dashboard securely");
  });

  it("mantiene le stesse chiavi host in tutte e sette le lingue", () => {
    const keys = [
      "host_setup.option.local.title",
      "host_setup.option.local.line1",
      "host_setup.option.local.line2",
      "host_setup.option.vps.title",
      "host_setup.option.vps.line1",
      "host_setup.option.vps.line2",
    ];
    for (const locale of LOCALES) {
      const catalog = JSON.parse(
        read(`shared/locales/${locale}.json`),
      ) as Record<string, string>;
      for (const key of keys) expect(catalog[key], `${locale}.${key}`).toBeTruthy();
      expect(catalog["host_setup.option.local.line2"].toLowerCase()).not.toMatch(
        /dashboard|panel web|tableau de bord|irányítópult/,
      );
      expect(catalog["host_setup.option.vps.line2"].toLowerCase()).not.toMatch(
        /dashboard|panel web|tableau de bord|irányítópult/,
      );
    }
  });

  it("su VPS il pairing cloud resta una copia facoltativa, non un gate", () => {
    const historicalOnboarding = read(
      "docs/internal/architecture/onboarding-flow.md",
    );
    expect(cliSetup).toContain("wizard.cloud.enable_prompt");
    expect(cliSetup).not.toContain("await prompter.outro(t('wizard.cloud.pairing_failed'))");
    expect(cliSetup.indexOf("wizard.cloud.pairing_failed")).toBeLessThan(
      cliSetup.indexOf("wizard.provider.prompt"),
    );
    expect(read("docs/guides/VPS-SETUP.md")).toContain(
      "Skipping or failing cloud pairing does not block the",
    );
    expect(historicalOnboarding).toContain(
      "Saltarlo o fallirlo non blocca",
    );
    expect(historicalOnboarding).not.toMatch(
      /VPS[^\n]{0,40}(?:sync|cloud)[^\n]{0,40}(?:obbligatorio|strutturalmente obbligatorio)/i,
    );
    const mandatoryVpsCloud = /(?:mandatory for VPS|VPS\s*:\s*(?:OBBLIGATORIO|mandatory|required)|VPS[^\n]{0,50}requires[^\n]{0,50}(?:cloud|account|pairing|jht cloud login)|VPS mode[^\n]{0,50}richiede[^\n]{0,50}signed-in|signed-in mode[^\n]{0,50}(?:necessari[oa]|obbligatori[oa])[^\n]{0,50}(?:VPS|Path 2)|(?:account (?:cloud|web)|cloud account)[^\n]{0,50}(?:necessari[oa]|obbligatori[oa]|required|mandatory)|(?:cloud|sync)[^\n]{0,50}(?:obbligatori[oa]|mandatory|required)[^\n]{0,50}(?:VPS|Path 2))/i;
    for (const staleClaim of [
      "VPS requires jht cloud login before it completes",
      "VPS mode richiede signed-in mode",
      "signed-in mode necessario per VPS",
      "account cloud obbligatorio per Path 2",
    ]) {
      expect(mandatoryVpsCloud.test(staleClaim), staleClaim).toBe(true);
    }
    const staleDocs = activeDocumentation()
      .filter(([, contents]) => mandatoryVpsCloud.test(contents))
      .map(([file]) => file);
    expect(staleDocs).toEqual([]);
    for (const locale of LOCALES) {
      const catalog = JSON.parse(
        read(`shared/locales/${locale}.json`),
      ) as Record<string, string>;
      expect(catalog["wizard.cloud.enable_prompt"], locale).toBeTruthy();
      expect(catalog["wizard.cloud.pairing_body"], locale).toContain("jht cloud login");
      expect(catalog["wizard.cloud.login_title"], locale).not.toMatch(
        /required|obbligatorio|obligatorio|obligatoire|erforderlich|kötelező|obrigatório/i,
      );
    }
  });
});

describe("gioco — PC locale first-class, VPS esplicita", () => {
  it("l'onboarding scriptato presenta locale prima di VPS", () => {
    const local = scriptedOnboarding.indexOf(
      '["local", UIStrings.t("onb.c.intro.local")]',
    );
    const vps = scriptedOnboarding.indexOf(
      '["vps", UIStrings.t("onb.c.intro.vps")]',
    );
    expect(local).toBeGreaterThan(0);
    expect(local).toBeLessThan(vps);
  });

  it("il tour non offre come guidato il PC dedicato non validato", () => {
    const coordinator = gameTour.match(
      /"tour_coordinatore":\s*\{([\s\S]*?)\n\t\},\n\n\t##/,
    )?.[1];
    expect(coordinator).toBeTruthy();
    expect(coordinator).toContain("On this computer.");
    expect(coordinator).toContain("On a VPS");
    expect(coordinator).not.toContain("pick_dedicated");
    expect(coordinator).not.toContain("runtime:dedicated");
    expect(coordinator).not.toContain("always-on online computer");
  });

  it("i sette cataloghi nominano VPS e separano lo stato account", () => {
    for (const locale of LOCALES) {
      const file =
        locale === "it"
          ? "game/scripts/ui_strings.gd"
          : `game/scripts/i18n/ui_${locale}.gd`;
      const catalog = read(file);
      expect(catalog, locale).toContain('"onb.c.intro.vps"');
      expect(
        catalog.match(/"onb\.c\.intro\.vps":\s*"([^"]+)"/)?.[1],
        locale,
      ).toContain("VPS");
      expect(catalog, locale).toContain('"account.not_connected"');
      expect(catalog, locale).not.toContain('"account.local_mode"');
    }
  });
});

describe("route pubbliche — il locale non e' una demo e il cloud non e' un host", () => {
  it("la landing nomina il PC locale prima delle opzioni remote", () => {
    expect(landing.match(/home_setup_body/g)?.length).toBe(5);
    expect(landing).not.toMatch(/always-on dedicated computer or an affordable VPS/i);
    expect(landing).not.toMatch(/computer dedicato sempre acceso o su una VPS/i);
    expect(landing).toContain("Local PC");
    expect(landing).toContain("PC locale");
  });

  it("la guida VPS non la dichiara requisito serio e non promette feature future gia presenti", () => {
    expect(vpsRoute).not.toMatch(/recommended setup for a real job search/i);
    expect(vpsRoute).not.toMatch(/configurazione consigliata per una ricerca di lavoro vera/i);
    expect(vpsRoute).not.toMatch(/coming soon|in arrivo|próximamente|bientôt|demnächst|hamarosan|em breve/i);
    expect(vpsRoute).not.toMatch(/VPS[^"\n]{0,80}(?:essential|essenziale|esencial|essentiel|essenziell|elengedhetetlen)/i);
    expect(vpsRoute).toContain("optionally pairs the server");
    expect(vpsRoute).toContain("controllare il runtime VPS via SSH");
    expect(vpsRoute).toContain("Local PC");
  });

  it("la privacy separa host e cloud opzionale", () => {
    expect(privacyRoute).not.toMatch(/local and cloud mode/i);
    expect(privacyRoute).not.toMatch(/modalita locale e cloud/i);
    expect(privacyRoute).not.toMatch(/the two modes are alternatives/i);
    expect(privacyRoute).toContain("optional cloud sync");
  });

  it("la guida setup resta locale completa con VPS separata", () => {
    expect(setupGuide).toContain("Job Hunter Team runs the local team in Docker");
    expect(setupGuide).toContain('href: DOCS_VPS');
    expect(setupGuide).not.toContain("local / guest mode");
  });

  it("la guida comparativa mantiene il decision tree canonico", () => {
    expect(chooseWhere).toMatch(/Run it on your\s+\*\*local PC\*\*/);
    expect(chooseWhere).toContain("If you are unsure, start locally");
    expect(chooseWhere).toContain("advanced topology, not separately validated as a guided path");
  });
});
