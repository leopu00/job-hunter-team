/**
 * [RUNTIME-UPGRADE] Il wrapper host e' l'unico proprietario dell'upgrade del
 * prodotto: scarica runtime metadata, cambia immagine e verifica il nuovo
 * container. Questi test eseguono il wrapper vero contro docker/curl finti;
 * non richiedono un daemon Docker e verificano il confine importante: un
 * deploy non verificabile torna all'immagine e al compose precedenti.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const WRAPPER = path.join(REPO, "scripts", "jht-wrapper.sh");
const posixOnly = process.platform === "win32" ? describe.skip : describe;

function writeExec(file: string, body: string) {
  writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`, "utf8");
  chmodSync(file, 0o755);
}

type Sandbox = {
  root: string;
  runtime: string;
  wrapper: string;
  state: () => string;
  compose: () => string;
  journal: () => boolean;
};

function makeSandbox({ verifyFails = false }: { verifyFails?: boolean } = {}): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "jht-runtime-upgrade-"));
  const bin = path.join(root, "bin");
  const runtime = path.join(root, "runtime");
  const release = path.join(root, "release");
  const installed = path.join(root, "installed-jht");
  const state = path.join(root, "container-image");
  mkdirSync(bin, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  mkdirSync(release, { recursive: true });
  writeFileSync(state, "sha256:old", "utf8");
  writeFileSync(path.join(runtime, "docker-compose.yml"), "services:\n  jht:\n    image: example/old\n", "utf8");
  copyFileSync(WRAPPER, installed);
  chmodSync(installed, 0o755);
  writeFileSync(path.join(release, "docker-compose.yml"), "services:\n  jht:\n    image: example/new\n", "utf8");
  // Basta essere uno script sintatticamente valido: il wrapper in esecuzione
  // deve poter sostituire se stesso soltanto DOPO che il nuovo runtime e'
  // sano, quindi la forma del file e' parte del preflight.
  writeFileSync(path.join(release, "jht-wrapper.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");

  writeExec(path.join(bin, "curl"), [
    'out=""',
    'url=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o) out="$2"; shift 2 ;;',
    '    *) url="$1"; shift ;;',
    '  esac',
    'done',
    'case "$url" in',
    '  */docker-compose.yml) cp "$FAKE_RELEASE/docker-compose.yml" "$out" ;;',
    '  */jht-wrapper.sh) cp "$FAKE_RELEASE/jht-wrapper.sh" "$out" ;;',
    '  *) exit 22 ;;',
    'esac',
  ].join("\n"));
  writeExec(path.join(bin, "sleep"), "exit 0");
  // Un runtime che dista centinaia di commit non deve avere un checkout Git
  // ne' dipendere da pull/rebase: se il wrapper prova a invocarlo il test
  // fallisce, mentre il percorso image-only resta completamente valido.
  writeExec(path.join(bin, "git"), "echo git-must-not-run >&2\nexit 99");

  writeExec(path.join(bin, "docker"), [
    'image_file="$FAKE_STATE"',
    'image="$(cat "$image_file" 2>/dev/null || true)"',
    'cmd="$1"; shift || true',
    'case "$cmd" in',
    '  info) exit 0 ;;',
    '  ps)',
    '    if [ -n "$image" ]; then echo jht; fi',
    '    exit 0 ;;',
    '  inspect)',
    '    target="$1"; shift || true',
    '    if [ -z "$image" ]; then exit 1; fi',
    '    if [ "$target" = "jht" ]; then echo "$image"; else echo "$FAKE_CANDIDATE"; fi',
    '    exit 0 ;;',
    '  image)',
    '    # docker image inspect IMAGE --format {{.Id}}',
    '    echo "$FAKE_CANDIDATE"; exit 0 ;;',
    '  exec)',
    '    if [ "${FAKE_VERIFY_FAIL:-0}" = "1" ] && ! echo "$image" | grep -q old; then exit 1; fi',
    '    case "$image" in *old*) echo 0.3.3 ;; *) echo 0.4.0 ;; esac',
    '    exit 0 ;;',
    '  rm)',
    '    : > "$image_file"; exit 0 ;;',
    '  compose)',
    '    args="$*"',
    '    case " $args " in',
    '      *" config -q "*) exit 0 ;;',
    '      *" pull "*) exit 0 ;;',
    '      *" rm "*) : > "$image_file"; exit 0 ;;',
    '      *" up "*) printf "%s" "${JHT_IMAGE:-$FAKE_CANDIDATE}" > "$image_file"; exit 0 ;;',
    '      *) exit 0 ;;',
    '    esac ;;',
    '  *) exit 1 ;;',
    'esac',
  ].join("\n"));

  return {
    root,
    runtime,
    wrapper: installed,
    state: () => readFileSync(state, "utf8"),
    compose: () => readFileSync(path.join(runtime, "docker-compose.yml"), "utf8"),
    journal: () => existsSync(path.join(runtime, ".upgrade-journal")),
  };
}

function run(sb: Sandbox, extra: Record<string, string> = {}, args = ["upgrade", "--json"]) {
  const result = spawnSync("bash", [sb.wrapper, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${path.join(sb.root, "bin")}:${process.env.PATH}`,
      JHT_RUNTIME_DIR: sb.runtime,
      JHT_COMPOSE_FILE: path.join(sb.runtime, "docker-compose.yml"),
      JHT_WRAPPER_PATH: sb.wrapper,
      JHT_RAW_BASE: "https://updates.invalid/release",
      FAKE_RELEASE: path.join(sb.root, "release"),
      FAKE_STATE: path.join(sb.root, "container-image"),
      FAKE_CANDIDATE: "sha256:new",
      ...extra,
    },
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

posixOnly("jht upgrade — runtime image atomico", () => {
  it("aggiorna runtime metadata e immagine, poi riferisce le versioni in JSON", () => {
    const sb = makeSandbox();
    const result = run(sb);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      changed: true,
      phase: "complete",
      previous: { version: "0.3.3", image: "sha256:old" },
      current: { version: "0.4.0", image: "sha256:new" },
      restartRequired: false,
    });
    expect(sb.state()).toBe("sha256:new");
    expect(sb.compose()).toContain("example/new");
    expect(sb.journal()).toBe(false);
  });

  it("se il candidato non supera la verifica ripristina immagine e compose precedenti", () => {
    const sb = makeSandbox({ verifyFails: true });
    const result = run(sb, { FAKE_VERIFY_FAIL: "1" });

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({ ok: false, phase: "verify", rolledBack: true });
    expect(sb.state()).toBe("sha256:old");
    expect(sb.compose()).toContain("example/old");
    expect(sb.journal()).toBe(false);
  });

  it("al run seguente sana un journal lasciato da un processo ucciso prima di un nuovo check", () => {
    const sb = makeSandbox();
    const rollback = path.join(sb.runtime, ".upgrade-rollback-interrupted");
    mkdirSync(rollback);
    copyFileSync(path.join(sb.runtime, "docker-compose.yml"), path.join(rollback, "docker-compose.yml"));
    copyFileSync(sb.wrapper, path.join(rollback, "jht-wrapper.sh"));
    writeFileSync(path.join(sb.runtime, "docker-compose.yml"), "services:\n  jht:\n    image: example/broken-candidate\n", "utf8");
    writeFileSync(path.join(sb.root, "container-image"), "sha256:new", "utf8");
    writeFileSync(path.join(sb.runtime, ".upgrade-journal"), [
      "version=1",
      "phase=candidate_started",
      `rollback_dir=${rollback}`,
      "old_image=sha256:old",
      "was_running=1",
      "",
    ].join("\n"), "utf8");

    const result = run(sb, {}, ["upgrade", "--json", "--check"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, phase: "check" });
    expect(sb.state()).toBe("sha256:old");
    expect(sb.compose()).toContain("example/old");
    expect(sb.journal()).toBe(false);
  });

  it("rifiuta fail-closed un journal con rollback path traversal senza toccare il runtime", () => {
    const sb = makeSandbox();
    const escaped = path.join(sb.root, "escaped");
    mkdirSync(escaped);
    mkdirSync(path.join(sb.runtime, ".upgrade-rollback-traverse"));
    copyFileSync(path.join(sb.runtime, "docker-compose.yml"), path.join(escaped, "docker-compose.yml"));
    copyFileSync(sb.wrapper, path.join(escaped, "jht-wrapper.sh"));
    writeFileSync(path.join(sb.runtime, "docker-compose.yml"), "services:\n  jht:\n    image: example/candidate\n", "utf8");
    writeFileSync(path.join(sb.root, "container-image"), "sha256:new", "utf8");
    const escapedThroughPrefix = path.join(sb.runtime, ".upgrade-rollback-traverse", "..", "..", "escaped");
    writeFileSync(path.join(sb.runtime, ".upgrade-journal"), [
      "version=1",
      "phase=candidate_started",
      `rollback_dir=${escapedThroughPrefix}`,
      "old_image=sha256:old",
      "was_running=1",
      "",
    ].join("\n"), "utf8");

    const result = run(sb, {}, ["upgrade", "--json", "--check"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, phase: "recovery" });
    expect(sb.state()).toBe("sha256:new");
    expect(sb.compose()).toContain("example/candidate");
    expect(sb.journal()).toBe(true);
  });

  it("rifiuta un journal malformato prima di sostituire metadata o container", () => {
    const sb = makeSandbox();
    const rollback = path.join(sb.runtime, ".upgrade-rollback-malformed");
    mkdirSync(rollback);
    copyFileSync(path.join(sb.runtime, "docker-compose.yml"), path.join(rollback, "docker-compose.yml"));
    copyFileSync(sb.wrapper, path.join(rollback, "jht-wrapper.sh"));
    writeFileSync(path.join(sb.runtime, "docker-compose.yml"), "services:\n  jht:\n    image: example/candidate\n", "utf8");
    writeFileSync(path.join(sb.root, "container-image"), "sha256:new", "utf8");
    writeFileSync(path.join(sb.runtime, ".upgrade-journal"), [
      "version=1",
      "phase=candidate_started",
      `rollback_dir=${rollback}`,
      "old_image=not-an-image",
      "was_running=false",
      "",
    ].join("\n"), "utf8");

    const result = run(sb, {}, ["upgrade", "--json", "--check"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, phase: "recovery" });
    expect(sb.state()).toBe("sha256:new");
    expect(sb.compose()).toContain("example/candidate");
    expect(sb.journal()).toBe(true);
  });
});
