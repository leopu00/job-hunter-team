/**
 * [RUNTIME-UPGRADE] Il wrapper host e' l'unico proprietario dell'upgrade del
 * prodotto: scarica runtime metadata, cambia immagine e verifica il nuovo
 * container. Questi test eseguono il wrapper vero contro docker/curl finti;
 * non richiedono un daemon Docker e verificano il confine importante: un
 * deploy non verificabile torna all'immagine e al compose precedenti.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const WRAPPER = path.join(REPO, "scripts", "jht-wrapper.sh");
const HOST_SETUP = path.join(REPO, "scripts", "host-setup.sh");
const POWERSHELL_WRAPPER = path.join(REPO, "scripts", "jht-wrapper.ps1");
const PODMAN_SYSTEMD_UNIT = `podman-compose${String.fromCharCode(64)}jht.service`;
const posixOnly = process.platform === "win32" ? describe.skip : describe;

// Regressione reale che il desktop deve riconoscere prima di invocare il
// check: il wrapper pubblicato in v0.3.3 interpreta qualunque flag dopo
// `upgrade` come un normale apply (compose pull + up), senza frame JSON.
// E' una fixture comportamentale ridotta dal dispatcher del tag, non una
// copia del wrapper corrente travestita da runtime vecchio.
const LEGACY_V033_UPGRADE_BEHAVIOR = [
  "#!/usr/bin/env bash",
  "# behavioral snapshot: scripts/jht-wrapper.sh at tag v0.3.3",
  "set -euo pipefail",
  'CONTAINER="${JHT_CONTAINER_NAME:-jht}"',
  'RUNTIME_DIR="${JHT_RUNTIME_DIR:-$HOME/.jht/runtime}"',
  'COMPOSE_FILE="${JHT_COMPOSE_FILE:-$RUNTIME_DIR/docker-compose.yml}"',
  'compose() { docker compose -f "$COMPOSE_FILE" --project-directory "$RUNTIME_DIR" "$@"; }',
  'case "${1:-}" in',
  "  upgrade)",
  "    docker info >/dev/null",
  '    test -f "$COMPOSE_FILE"',
  "    compose pull",
  "    compose up -d",
  "    ;;",
  "  *) exit 2 ;;",
  "esac",
  "",
].join("\n");

function historicV033Wrapper(): string {
  // In una checkout completa si esercita il blob esatto pubblicato. Le CI
  // shallow non hanno necessariamente il tag: la fixture comportamentale
  // mantiene comunque il confine critico senza dipendere dalla storia Git.
  const historical = spawnSync(
    "git",
    ["show", "v0.3.3:scripts/jht-wrapper.sh"],
    { encoding: "utf8" },
  );
  return historical.status === 0 && historical.stdout
    ? historical.stdout
    : LEGACY_V033_UPGRADE_BEHAVIOR;
}

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
  dockerCalls: () => string[];
};

function makeSandbox({
  verifyFails = false,
}: { verifyFails?: boolean } = {}): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "jht-runtime-upgrade-")));
  const bin = path.join(root, "bin");
  const runtime = path.join(root, "runtime");
  const release = path.join(root, "release");
  const installed = path.join(root, "installed-jht");
  const state = path.join(root, "container-image");
  const dockerLog = path.join(root, "docker-calls.log");
  mkdirSync(bin, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  mkdirSync(release, { recursive: true });
  writeFileSync(state, "sha256:old", "utf8");
  writeFileSync(
    path.join(runtime, "docker-compose.yml"),
    "services:\n  jht:\n    image: example/old\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\nvolumes:\n  jht-runtime-mask:\n",
    "utf8",
  );
  copyFileSync(WRAPPER, installed);
  chmodSync(installed, 0o755);
  copyFileSync(HOST_SETUP, path.join(runtime, "host-setup.sh"));
  chmodSync(path.join(runtime, "host-setup.sh"), 0o700);
  const digest = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(
    path.join(runtime, ".runtime-integrity"),
    [
      "version=1",
      `docker-compose.yml=${digest(path.join(runtime, "docker-compose.yml"))}`,
      `host-setup.sh=${digest(path.join(runtime, "host-setup.sh"))}`,
      `jht-wrapper.sh=${digest(installed)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    path.join(release, "docker-compose.yml"),
    "services:\n  jht:\n    image: example/new\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\nvolumes:\n  jht-runtime-mask:\n",
    "utf8",
  );
  // Basta essere uno script sintatticamente valido: il wrapper in esecuzione
  // deve poter sostituire se stesso soltanto DOPO che il nuovo runtime e'
  // sano, quindi la forma del file e' parte del preflight.
  writeFileSync(
    path.join(release, "jht-wrapper.sh"),
    "#!/usr/bin/env bash\nJHT_HOST_RUNTIME_PROTOCOL=1\nexit 0\n",
    "utf8",
  );

  writeExec(
    path.join(bin, "curl"),
    [
      'out=""',
      'url=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o) out="$2"; shift 2 ;;',
      '    *) url="$1"; shift ;;',
      "  esac",
      "done",
      'case "$url" in',
      '  */docker-compose.yml) cp "$FAKE_RELEASE/docker-compose.yml" "$out" ;;',
      '  */jht-wrapper.sh) cp "$FAKE_RELEASE/jht-wrapper.sh" "$out" ;;',
      "  *) exit 22 ;;",
      "esac",
    ].join("\n"),
  );
  writeExec(path.join(bin, "sleep"), "exit 0");
  // Un runtime che dista centinaia di commit non deve avere un checkout Git
  // ne' dipendere da pull/rebase: se il wrapper prova a invocarlo il test
  // fallisce, mentre il percorso image-only resta completamente valido.
  writeExec(path.join(bin, "git"), "echo git-must-not-run >&2\nexit 99");

  writeExec(
    path.join(bin, "docker"),
    [
      'image_file="$FAKE_STATE"',
      'printf \'%s\\n\' "$*" >> "$FAKE_DOCKER_LOG"',
      'image="$(cat "$image_file" 2>/dev/null || true)"',
      'cmd="$1"; shift || true',
      'case "$cmd" in',
      "  info) exit 0 ;;",
      "  ps)",
      '    if [ -n "$image" ]; then echo jht; fi',
      "    exit 0 ;;",
      "  inspect)",
      '    if [ "$1:$2" = --type:container ]; then',
      '      target="$3"; shift 3 || true',
      '      [ "$target" = aaaaaaaaaaaa ] || exit 1',
      '      printf "true jht\\n"',
      '      exit 0',
      '    fi',
      '    target="$1"; shift || true',
      '    if [ -z "$image" ]; then exit 1; fi',
      '    if [ "$target" = "jht" ] || [ "$target" = aaaaaaaaaaaa ]; then echo "$image"; else echo "$FAKE_CANDIDATE"; fi',
      "    exit 0 ;;",
      "  image)",
      "    # docker image inspect IMAGE --format {{.Id}}",
      '    if [ "${FAKE_ABSENT_IMAGE:-}" = "${2:-}" ]; then exit 1; fi',
      '    echo "$FAKE_CANDIDATE"; exit 0 ;;',
      "  exec)",
      '    if [ "${FAKE_VERIFY_FAIL:-0}" = "1" ] && ! echo "$image" | grep -q old; then exit 1; fi',
      '    case "$image" in *old*) echo 0.3.3 ;; *) echo 0.4.0 ;; esac',
      "    exit 0 ;;",
      "  rm)",
      '    : > "$image_file"; exit 0 ;;',
      "  compose)",
      '    args="$*"',
      '    case " $args " in',
      '      *" ps -q jht "*) if [ -n "$image" ]; then echo aaaaaaaaaaaa; fi; exit 0 ;;',
      '      *" config -q "*) exit 0 ;;',
      '      *" pull "*) exit 0 ;;',
      '      *" rm "*) : > "$image_file"; exit 0 ;;',
      '      *" up "*)',
      '        case " $args " in *" -f $FAKE_RUNTIME/docker-compose.yml --project-directory $FAKE_RUNTIME "*) ;; *) [ "${FAKE_ALLOW_LEGACY_COMPOSE:-0}" = 1 ] || exit 74 ;; esac',
      '        printf "%s" "${JHT_IMAGE:-$FAKE_CANDIDATE}" > "$image_file"; exit 0 ;;',
      "      *) exit 0 ;;",
      "    esac ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
  );

  return {
    root,
    runtime,
    wrapper: installed,
    state: () => readFileSync(state, "utf8"),
    compose: () =>
      readFileSync(path.join(runtime, "docker-compose.yml"), "utf8"),
    journal: () => existsSync(path.join(runtime, ".upgrade-journal")),
    dockerCalls: () =>
      existsSync(dockerLog)
        ? readFileSync(dockerLog, "utf8").trim().split("\n").filter(Boolean)
        : [],
  };
}

type PodmanHarness = {
  env: Record<string, string>;
  labelHash: () => string;
  setLabelHash: (value: string) => void;
  labelConfig: () => string;
  labelWorking: () => string;
};

function enableExactPodmanHarness(sb: Sandbox): PodmanHarness {
  const bin = path.join(sb.root, "bin");
  const adapterDir = path.join(sb.runtime, "bin");
  const shim = path.join(adapterDir, "docker");
  const selection = path.join(sb.runtime, "container-runtime");
  const machine = path.join(sb.runtime, "podman-machine");
  const labelHash = path.join(sb.root, "label-hash");
  const labelConfig = path.join(sb.root, "label-config");
  const labelWorking = path.join(sb.root, "label-working");
  const oldHash = "a".repeat(64);
  mkdirSync(adapterDir);
  writeFileSync(selection, "podman\n", "utf8");
  writeFileSync(machine, "jht-podman\n", "utf8");
  writeFileSync(labelHash, oldHash, "utf8");
  writeFileSync(labelConfig, path.join(sb.runtime, "docker-compose.yml"), "utf8");
  writeFileSync(labelWorking, sb.runtime, "utf8");

  writeExec(
    shim,
    [
      "# JHT_PODMAN_DOCKER_SHIM=1",
      'printf \'docker %s\\n\' "$*" >> "$FAKE_DOCKER_LOG"',
      'cmd="$1"; shift || true',
      'case "$cmd" in',
      "  info) exit 0 ;;",
      "  inspect)",
      '    if [ "$1:$2" = --type:container ]; then',
      '      [ "$3" = aaaaaaaaaaaa ] || exit 91',
      `      printf "jht|true|jht|jht|jht|jht|1|%s|%s|1.6.0|${PODMAN_SYSTEMD_UNIT}|%s\\n" "$(cat "$FAKE_LABEL_WORKING")" "$(cat "$FAKE_LABEL_CONFIG")" "$(cat "$FAKE_LABEL_HASH")"`,
      "      exit 0",
      "    fi",
      '    target="$1"; shift || true',
      '    [ -s "$FAKE_STATE" ] || exit 1',
      '    case "$*" in',
      '      *".Image"*) cat "$FAKE_STATE" ;;',
      '      *".State.Running"*) printf "true\\n" ;;',
      '      *) cat "$FAKE_STATE" ;;',
      "    esac ;;",
      "  image) echo \"$FAKE_CANDIDATE\" ;;",
      "  exec)",
      '    case "$*" in',
      '      *"node -e"*) printf "1 1 1" ;;',
      '      *"tmux has-session"*|*"test -f"*) exit 0 ;;',
      '      *"--version"*) case "$(cat "$FAKE_STATE")" in *old*) echo 0.3.3 ;; *) echo 0.4.0 ;; esac ;;',
      "      *) exit 0 ;;",
      "    esac ;;",
      "  *) exit 92 ;;",
      "esac",
    ].join("\n"),
  );
  writeExec(
    path.join(bin, "podman"),
    [
      'if [ "$1" = --version ]; then echo "podman version 6.1.3"; exit 0; fi',
      'printf \'podman connection=%s argv=%s\\n\' "${CONTAINER_CONNECTION:-}" "$*" >> "$FAKE_DOCKER_LOG"',
      '[ "$1:$2:$3" = --connection:jht-podman:info ] && exit 0',
      'if [ "$1" = ps ]; then',
      '  [ "$CONTAINER_CONNECTION" = jht-podman ] || exit 125',
      '  case " $* " in *" --connection "*) exit 125 ;; esac',
      "  exit 0",
      "fi",
      "exit 126",
    ].join("\n"),
  );
  writeExec(
    path.join(bin, "podman-compose"),
    [
      'if [ "$1" = --version ]; then echo "podman-compose version 1.6.0"; exit 0; fi',
      'dry=0; project=""; podman_path=""; file=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --verbose) shift ;;',
      '    --dry-run) dry=1; shift ;;',
      '    --project-name|-p) project="$2"; shift 2 ;;',
      '    --podman-path) podman_path="$2"; shift 2 ;;',
      '    -f) file="$2"; shift 2 ;;',
      '    *) command="$1"; shift; break ;;',
      "  esac",
      "done",
      '[ "$project" = jht ] || exit 118',
      'printf \'provider dry=%s project=%s file=%s command=%s args=%s\\n\' "$dry" "$project" "$file" "$command" "$*" >> "$FAKE_DOCKER_LOG"',
      'hash="' + oldHash + '"',
      'grep -q "example/new" "$file" && hash="' + "b".repeat(64) + '"',
      'if [ "$dry" = 1 ]; then',
      '  [ "$command:$*" = "up:-d --force-recreate jht" ] || exit 117',
      '  "$podman_path" ps -a --filter label=io.podman.compose.project=jht --format "{{.ID}}"',
      '  printf "INFO --label io.podman.compose.config-hash=%s --label next=value\\n" "$hash" >&2',
      "  exit 0",
      "fi",
      'case "$command" in',
      '  ps) [ "$*" = -q ] || exit 116; [ -s "$FAKE_STATE" ] && echo aaaaaaaaaaaa ;;',
      "  config) exit 0 ;;",
      "  pull) exit 0 ;;",
      "  up)",
      '    [ "$file" = "$FAKE_RUNTIME/docker-compose.yml" ] || exit 74',
      '    [ "$*" = "-d --force-recreate jht" ] || exit 73',
      '    printf "%s" "${JHT_IMAGE:-$FAKE_CANDIDATE}" > "$FAKE_STATE"',
      '    printf "%s" "$hash" > "$FAKE_LABEL_HASH"',
      '    printf "%s" "$FAKE_RUNTIME" > "$FAKE_LABEL_WORKING"',
      '    printf "%s" "$FAKE_RUNTIME/docker-compose.yml" > "$FAKE_LABEL_CONFIG" ;;',
      '  rm) : > "$FAKE_STATE" ;;',
      "  *) exit 115 ;;",
      "esac",
    ].join("\n"),
  );

  copyFileSync(WRAPPER, path.join(sb.root, "release", "jht-wrapper.sh"));
  chmodSync(path.join(sb.root, "release", "jht-wrapper.sh"), 0o755);
  const digest = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  const manifest = path.join(sb.runtime, ".runtime-integrity");
  const lines = readFileSync(manifest, "utf8").trim().split("\n");
  lines.push(
    `container-runtime=${digest(selection)}`,
    `podman-machine=${digest(machine)}`,
    `docker-shim=${digest(shim)}`,
    "",
  );
  writeFileSync(manifest, lines.join("\n"), "utf8");

  return {
    env: {
      FAKE_LABEL_HASH: labelHash,
      FAKE_LABEL_CONFIG: labelConfig,
      FAKE_LABEL_WORKING: labelWorking,
    },
    labelHash: () => readFileSync(labelHash, "utf8"),
    setLabelHash: (value: string) => writeFileSync(labelHash, value, "utf8"),
    labelConfig: () => readFileSync(labelConfig, "utf8"),
    labelWorking: () => readFileSync(labelWorking, "utf8"),
  };
}

function run(
  sb: Sandbox,
  extra: Record<string, string> = {},
  args = ["upgrade", "--json"],
) {
  const result = spawnSync("bash", [sb.wrapper, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${path.join(sb.root, "bin")}:${process.env.PATH}`,
      HOME: sb.root,
      JHT_HOME_HOST: path.join(sb.root, ".jht"),
      JHT_USER_DIR_HOST: path.join(sb.root, "Documents", "Job Hunter Team"),
      JHT_RUNTIME_DIR: sb.runtime,
      JHT_COMPOSE_FILE: path.join(sb.runtime, "docker-compose.yml"),
      JHT_WRAPPER_PATH: sb.wrapper,
      JHT_RAW_BASE: "https://updates.invalid/release",
      FAKE_RELEASE: path.join(sb.root, "release"),
      FAKE_STATE: path.join(sb.root, "container-image"),
      FAKE_DOCKER_LOG: path.join(sb.root, "docker-calls.log"),
      FAKE_RUNTIME: sb.runtime,
      FAKE_CANDIDATE: "sha256:new",
      ...extra,
    },
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

posixOnly("jht upgrade — runtime image atomico", () => {
  it("distingue il contratto atomico dal dispatcher legacy v0.3.3", () => {
    // Il client desktop deve poter riconoscere il wrapper capace prima di
    // passargli --check: sul legacy quel flag era ignorato e mutava il deploy.
    expect(readFileSync(WRAPPER, "utf8")).toContain("JHT_UPGRADE_PROTOCOL=1");
    expect(readFileSync(POWERSHELL_WRAPPER, "utf8")).toContain(
      "$JHT_UPGRADE_PROTOCOL = 1",
    );
    const legacy = historicV033Wrapper();
    expect(legacy).not.toContain("JHT_UPGRADE_PROTOCOL=1");

    const sb = makeSandbox();
    writeFileSync(sb.wrapper, legacy, "utf8");
    chmodSync(sb.wrapper, 0o755);
    const result = run(
      sb,
      { FAKE_ALLOW_LEGACY_COMPOSE: "1" },
      ["upgrade", "--check", "--json"],
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    // Questa e' la regressione da evitare con il bootstrap nel desktop: non
    // basta dichiarare una versione vecchia nell'immagine, va usato il
    // comportamento del vecchio wrapper host.
    expect(sb.state()).toBe("sha256:new");
  });

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
    const calls = sb.dockerCalls();
    const activation = calls.filter(
      (line) => line.startsWith("compose ") && line.includes(" up -d --force-recreate jht"),
    );
    expect(activation).toHaveLength(1);
    expect(activation[0]).toContain(
      `-f ${path.join(sb.runtime, "docker-compose.yml")} --project-directory ${sb.runtime}`,
    );
    expect(activation[0]).not.toContain(".upgrade-stage.");
    expect(
      calls.filter((line) => line.includes("inspect --type container aaaaaaaaaaaa"))
        .length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("Podman 6.1.3 applica dal compose canonico e verifica ownership e config-hash", () => {
    const sb = makeSandbox();
    const podman = enableExactPodmanHarness(sb);
    const result = run(sb, podman.env);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      phase: "complete",
      current: { version: "0.4.0", image: "sha256:new" },
    });
    expect(podman.labelHash()).toBe("b".repeat(64));
    expect(podman.labelWorking()).toBe(sb.runtime);
    expect(podman.labelConfig()).toBe(path.join(sb.runtime, "docker-compose.yml"));

    const calls = sb.dockerCalls();
    const realUp = calls.filter(
      (line) => line.startsWith("provider dry=0 ") && line.includes(" command=up "),
    );
    expect(realUp).toHaveLength(1);
    expect(realUp[0]).toContain(
      `project=jht file=${path.join(sb.runtime, "docker-compose.yml")}`,
    );
    expect(realUp[0]).toContain("args=-d --force-recreate jht");
    expect(realUp[0]).not.toContain(".upgrade-stage.");
    expect(
      calls.filter((line) => line.includes("docker inspect --type container aaaaaaaaaaaa"))
        .length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      calls.some(
        (line) =>
          line.includes("podman connection=jht-podman argv=ps -a") &&
          line.includes("label=io.podman.compose.project=jht"),
      ),
    ).toBe(true);

    const chat = run(sb, podman.env, ["desktop-chat", "probe"]);
    const snapshot = run(sb, podman.env, ["onboarding-snapshot"]);
    expect(chat.code).toBe(0);
    expect(chat.stdout).toBe("true\n");
    expect(snapshot.code).toBe(0);
    expect(snapshot.stdout).toContain("containerRunning=1");

    podman.setLabelHash("c".repeat(64));
    const staleChat = run(sb, podman.env, ["desktop-chat", "probe"]);
    const staleSnapshot = run(sb, podman.env, ["onboarding-snapshot"]);
    expect(staleChat.code).toBe(1);
    expect(staleSnapshot.code).toBe(0);
    expect(staleSnapshot.stdout).toContain("containerRunning=0");
  });

  it("se il candidato non supera la verifica ripristina immagine e compose precedenti", () => {
    const sb = makeSandbox({ verifyFails: true });
    // Il candidato non passa mai: con le 20 osservazioni di produzione il
    // wrapper le fa tutte, una decina di processi a giro, 4,3 s su 5 di
    // timeout. Ne bastano due per provare lo stesso esito.
    const result = run(sb, { FAKE_VERIFY_FAIL: "1", JHT_UPGRADE_VERIFY_TRIES: "2" });

    expect(result.code).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: false,
      phase: "verify",
      rolledBack: true,
    });
    expect(sb.state()).toBe("sha256:old");
    expect(sb.compose()).toContain("example/old");
    expect(sb.journal()).toBe(false);
  });

  it("--check --json da un runtime vecchio trova l'immagine nuova senza modificare il deploy", () => {
    const sb = makeSandbox();
    const result = run(sb, {}, ["upgrade", "--check", "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      changed: true,
      phase: "check",
      previous: { version: "0.3.3", image: "sha256:old" },
      current: { version: "0.3.3", image: "sha256:new" },
      restartRequired: true,
    });
    expect(sb.state()).toBe("sha256:old");
    expect(sb.compose()).toContain("example/old");
    expect(sb.journal()).toBe(false);
  });

  it.each(["wrapper-protocol", "compose-mask"])(
    "rifiuta una release che regredisce il confine host: %s",
    (missing) => {
      const sb = makeSandbox();
      if (missing === "wrapper-protocol") {
        writeFileSync(
          path.join(sb.root, "release", "jht-wrapper.sh"),
          "#!/usr/bin/env bash\nexit 0\n",
          "utf8",
        );
      } else {
        writeFileSync(
          path.join(sb.root, "release", "docker-compose.yml"),
          "services:\n  jht:\n    image: example/new\n",
          "utf8",
        );
      }

      const result = run(sb, {}, ["upgrade", "--check", "--json"]);

      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        phase: "preflight",
      });
      expect(sb.state()).toBe("sha256:old");
      expect(readFileSync(sb.wrapper, "utf8")).toContain(
        "JHT_HOST_RUNTIME_PROTOCOL=1",
      );
      expect(sb.journal()).toBe(false);
    },
  );

  it("al run seguente sana un journal lasciato da un processo ucciso prima di un nuovo check", () => {
    const sb = makeSandbox();
    const rollback = path.join(sb.runtime, ".upgrade-rollback-interrupted");
    mkdirSync(rollback);
    copyFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      path.join(rollback, "docker-compose.yml"),
    );
    copyFileSync(sb.wrapper, path.join(rollback, "jht-wrapper.sh"));
    copyFileSync(path.join(sb.runtime, ".runtime-integrity"), path.join(rollback, ".runtime-integrity"));
    writeFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      "services:\n  jht:\n    image: example/broken-candidate\n",
      "utf8",
    );
    writeFileSync(path.join(sb.root, "container-image"), "sha256:new", "utf8");
    writeFileSync(
      path.join(sb.runtime, ".upgrade-journal"),
      [
        "version=1",
        "phase=candidate_started",
        `rollback_dir=${rollback}`,
        "old_image=sha256:old",
        "was_running=1",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = run(sb, {}, ["upgrade", "--json", "--check"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      phase: "check",
    });
    expect(sb.state()).toBe("sha256:old");
    expect(sb.compose()).toContain("example/old");
    expect(sb.journal()).toBe(false);
  });

  it("rifiuta fail-closed un journal con rollback path traversal senza toccare il runtime", () => {
    const sb = makeSandbox();
    const escaped = path.join(sb.root, "escaped");
    mkdirSync(escaped);
    mkdirSync(path.join(sb.runtime, ".upgrade-rollback-traverse"));
    copyFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      path.join(escaped, "docker-compose.yml"),
    );
    copyFileSync(sb.wrapper, path.join(escaped, "jht-wrapper.sh"));
    copyFileSync(path.join(sb.runtime, ".runtime-integrity"), path.join(escaped, ".runtime-integrity"));
    writeFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      "services:\n  jht:\n    image: example/candidate\n",
      "utf8",
    );
    writeFileSync(path.join(sb.root, "container-image"), "sha256:new", "utf8");
    const escapedThroughPrefix = path.join(
      sb.runtime,
      ".upgrade-rollback-traverse",
      "..",
      "..",
      "escaped",
    );
    writeFileSync(
      path.join(sb.runtime, ".upgrade-journal"),
      [
        "version=1",
        "phase=candidate_started",
        `rollback_dir=${escapedThroughPrefix}`,
        "old_image=sha256:old",
        "was_running=1",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = run(sb, {}, ["upgrade", "--json", "--check"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      phase: "recovery",
    });
    expect(sb.state()).toBe("sha256:new");
    expect(sb.compose()).toContain("example/candidate");
    expect(sb.journal()).toBe(true);
  });

  it("rifiuta un journal malformato prima di sostituire metadata o container", () => {
    const sb = makeSandbox();
    const rollback = path.join(sb.runtime, ".upgrade-rollback-malformed");
    mkdirSync(rollback);
    copyFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      path.join(rollback, "docker-compose.yml"),
    );
    copyFileSync(sb.wrapper, path.join(rollback, "jht-wrapper.sh"));
    copyFileSync(path.join(sb.runtime, ".runtime-integrity"), path.join(rollback, ".runtime-integrity"));
    writeFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      "services:\n  jht:\n    image: example/candidate\n",
      "utf8",
    );
    writeFileSync(path.join(sb.root, "container-image"), "sha256:new", "utf8");
    writeFileSync(
      path.join(sb.runtime, ".upgrade-journal"),
      [
        "version=1",
        "phase=candidate_started",
        `rollback_dir=${rollback}`,
        "old_image=not-an-image",
        "was_running=false",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = run(sb, {}, ["upgrade", "--json", "--check"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      phase: "recovery",
    });
    expect(sb.state()).toBe("sha256:new");
    expect(sb.compose()).toContain("example/candidate");
    expect(sb.journal()).toBe(true);
  });

  it("rifiuta un digest rollback ben formato ma assente prima di toccare il runtime", () => {
    const sb = makeSandbox();
    const rollback = path.join(sb.runtime, ".upgrade-rollback-missing-image");
    mkdirSync(rollback);
    copyFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      path.join(rollback, "docker-compose.yml"),
    );
    copyFileSync(sb.wrapper, path.join(rollback, "jht-wrapper.sh"));
    copyFileSync(path.join(sb.runtime, ".runtime-integrity"), path.join(rollback, ".runtime-integrity"));
    writeFileSync(
      path.join(sb.runtime, "docker-compose.yml"),
      "services:\n  jht:\n    image: example/candidate\n",
      "utf8",
    );
    writeFileSync(path.join(sb.root, "container-image"), "sha256:new", "utf8");
    writeFileSync(
      path.join(sb.runtime, ".upgrade-journal"),
      [
        "version=1",
        "phase=candidate_started",
        `rollback_dir=${rollback}`,
        "old_image=sha256:deadbeef",
        "was_running=1",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = run(sb, { FAKE_ABSENT_IMAGE: "sha256:deadbeef" }, [
      "upgrade",
      "--json",
      "--check",
    ]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      phase: "recovery",
    });
    expect(sb.state()).toBe("sha256:new");
    expect(sb.compose()).toContain("example/candidate");
    expect(sb.journal()).toBe(true);
  });

  it("rifiuta snapshot rollback scrivibili da altri prima del ripristino", () => {
    const sb = makeSandbox();
    const rollback = path.join(sb.runtime, ".upgrade-rollback-open-mode");
    mkdirSync(rollback);
    const snapshot = path.join(rollback, "docker-compose.yml");
    copyFileSync(path.join(sb.runtime, "docker-compose.yml"), snapshot);
    copyFileSync(sb.wrapper, path.join(rollback, "jht-wrapper.sh"));
    copyFileSync(
      path.join(sb.runtime, ".runtime-integrity"),
      path.join(rollback, ".runtime-integrity"),
    );
    chmodSync(snapshot, 0o666);
    writeFileSync(
      path.join(sb.runtime, ".upgrade-journal"),
      [
        "version=1",
        "phase=prepared",
        `rollback_dir=${rollback}`,
        "old_image=none",
        "was_running=0",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = run(sb, {}, ["upgrade", "--json", "--check"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      phase: "recovery",
    });
    expect(sb.state()).toBe("sha256:old");
    expect(sb.journal()).toBe(true);
    expect(sb.dockerCalls()).toEqual([]);
  });
});
