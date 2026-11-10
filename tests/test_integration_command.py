"""`jht integration list|status|add|remove` (P9): the host script, run with the real wrapper functions it relies on.

The library scripts/jht-integration.sh is sourced into a bash that has the wrapper's own `runtime_node_safe` and stand-ins for
the engine (a fake `docker` on PATH, a compose that records what it is asked). Checked:

- the id is one of a closed list; a hostile id never reaches the engine or a shell;
- the state comes from the engine (container attested running, volume of the project) and from host markers, never from the container;
- add/remove do what the table says, and what the person did not ask (a purge) does not happen;
- the wrapper attests the helper like host-setup.sh (a changed file is refused) and the installer lists the same helpers.

Run with: pytest tests/test_integration_command.py -v
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
INSTALLER = ROOT / "scripts" / "install.sh"
LIBRARY = ROOT / "scripts" / "jht-integration.sh"

FAKE_DOCKER = r"""#!/bin/sh
printf 'DOCKER %s\n' "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "volume ls") cat "$FAKE_VOLUMES" 2>/dev/null; exit 0 ;;
  "volume rm") grep -vx "$3" "$FAKE_VOLUMES" > "$FAKE_VOLUMES.new"; mv "$FAKE_VOLUMES.new" "$FAKE_VOLUMES"; exit 0 ;;
  "info "*) exit "${FAKE_INFO_RC:-0}" ;;
esac
if [ "$1" = exec ]; then
  [ -z "$FAKE_EXEC_FAIL" ] || { echo "No matching distribution found for gspread"; exit 1; }
  exit 0
fi
exit 0
"""


def wrapper_functions(*names: str) -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        out.append(match.group(0))
    return "\n".join(out)


@pytest.fixture
def host(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(FAKE_DOCKER)
    (bin_dir / "docker").chmod(0o755)
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700)
    compose = runtime / "docker-compose.yml"
    compose.write_text("services:\n  jht:\n    image: x\n  jht-broker:\n    image: x\n  jht-telegram:\n    profiles: [telegram]\n    image: x\n")
    for name in ("log", "volumes", "running"):
        (tmp_path / name).write_text("")
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_LOG": str(tmp_path / "log"),
           "FAKE_VOLUMES": str(tmp_path / "volumes"), "FAKE_RUNNING": str(tmp_path / "running")}

    class H:
        pass

    h = H()
    h.tmp, h.runtime, h.compose, h.env = tmp_path, runtime, compose, env
    h.log, h.volumes, h.running = tmp_path / "log", tmp_path / "volumes", tmp_path / "running"
    return h


def run(host, args: str, extra_env: dict | None = None) -> subprocess.CompletedProcess:
    script = f"""
set -euo pipefail
HOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"
err() {{ echo "error: $*" >&2; }}; info() {{ echo "info: $*" >&2; }}
RUNTIME_DIR="{host.runtime}"; COMPOSE_FILE="{host.compose}"
BROKER_SERVICE=jht-broker; TELEGRAM_SERVICE=jht-telegram; JHT_HOST_TYPE=local
BROKER_WANTED_MARKER="$RUNTIME_DIR/.broker-made"
{wrapper_functions("runtime_stat", "runtime_node_safe")}
compose_project_name() {{ echo jht; }}
docker_reachable() {{ docker info >/dev/null 2>&1; }}
require_docker() {{ docker_reachable || {{ err "motore spento"; exit 1; }}; }}
ensure_up() {{ ATTESTED_CONTAINER_ID=agent-id; }}
read_only_service_id() {{
  if [ -n "${{FAKE_AMBIGUOUS:-}}" ]; then return 1; fi
  grep -qx "$1" "$FAKE_RUNNING" && {{ echo "id-$1"; return 0; }}; return 3
}}
compose() {{
  printf 'COMPOSE profiles=%s %s\\n' "${{COMPOSE_PROFILES:-}}" "$*" >> "$FAKE_LOG"
  [ -z "${{FAKE_COMPOSE_FAIL:-}}" ] || return 1
  case "$1 $2" in
    "up -d") echo "$3" >> "$FAKE_RUNNING" ;;
    "stop "*) grep -vx "$2" "$FAKE_RUNNING" > "$FAKE_RUNNING.new" || true; mv "$FAKE_RUNNING.new" "$FAKE_RUNNING" ;;
  esac
}}
telegram_lifecycle_verify() {{ grep -qx jht-telegram "$FAKE_RUNNING"; }}
ensure_broker() {{ COMPOSE_PROFILES=broker compose up -d "$BROKER_SERVICE"; }}  # the step that makes it: tests/test_broker_on_request.py
telegram_bots_configured() {{ case "${{FAKE_BOTS:-}}" in none) return 1 ;; some) return 0 ;; *) return 2 ;; esac; }}
. "{LIBRARY}"
integration_main {args}
"""
    return subprocess.run(["bash", "-c", script], env={**host.env, **(extra_env or {})}, capture_output=True, text=True, timeout=30)


def states(result) -> dict:
    return {row["id"]: row for row in json.loads(result.stdout)["integrations"]}


def test_list_json_nothing_added_and_three_not_available_yet(host):
    result = run(host, "list --json")
    assert result.returncode == 0, result.stderr
    rows = states(result)
    assert list(rows) == ["google", "telegram", "mail", "linkedin-login", "screen", "media"]
    assert {rows[i]["state"] for i in ("google", "telegram", "mail")} == {"not_installed"}
    for name in ("linkedin-login", "screen", "media"):
        assert rows[name] == {"id": name, "state": "not_installed", "reason": "non disponibile ancora"}


def test_state_is_running_ready_error_from_the_engine(host):
    host.running.write_text("jht-broker\n")
    host.volumes.write_text("jht_jht-telegram-state\njht_other\n")
    rows = states(run(host, "list --json"))
    assert rows["mail"]["state"] == "running"
    assert rows["telegram"]["state"] == "ready"
    ambiguous = states(run(host, "list --json", {"FAKE_AMBIGUOUS": "1"}))
    assert ambiguous["mail"]["state"] == "error" and ambiguous["telegram"]["state"] == "error"
    down = states(run(host, "list --json", {"FAKE_INFO_RC": "1"}))
    assert down["mail"] == {"id": "mail", "state": "error", "reason": "il motore dei container non risponde"}
    assert down["google"]["state"] == "not_installed"  # needs no engine


def test_telegram_up_without_a_bot_is_not_called_running(host):
    """One true state with `jht status`: a service that is up but holds no bot waits for a token, it is not «acceso»."""
    host.running.write_text("jht-telegram\n")
    host.volumes.write_text("jht_jht-telegram-state\n")
    waiting = states(run(host, "list --json", {"FAKE_BOTS": "none"}))["telegram"]
    assert waiting["state"] == "ready"
    assert "nessun bot abbinato" in waiting["reason"] and "jht telegram pair assistente" in waiting["reason"]
    # a bot is there, or it cannot be told: what the engine says (acceso) stays
    assert states(run(host, "list --json", {"FAKE_BOTS": "some"}))["telegram"]["state"] == "running"
    assert states(run(host, "list --json"))["telegram"]["state"] == "running"
    # the plain text and `status telegram` say the same
    plain = run(host, "status telegram", {"FAKE_BOTS": "none"})
    assert "aggiunto" in plain.stdout and "nessun bot abbinato" in plain.stdout and "pronto" not in plain.stdout


def test_status_for_one_id_and_plain_text(host):
    one = run(host, "status mail --json")
    assert json.loads(one.stdout) == {"id": "mail", "state": "not_installed", "reason": "non ancora aggiunto"}
    plain = run(host, "status")
    assert "google" in plain.stdout and "non installato" in plain.stdout and "non disponibile ancora" in plain.stdout


def test_the_state_never_reads_a_file_the_container_could_write(host):
    # a volume name that only LOOKS right, in a project that is not ours, is not the integration
    host.volumes.write_text("other_jht-telegram-state\n")
    assert states(run(host, "list --json"))["telegram"]["state"] == "not_installed"


def test_add_telegram_starts_the_profile_and_reports_running(host):
    result = run(host, "add telegram --json")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["ok"] is True
    assert json.loads(result.stdout)["state"] == "running"
    assert "COMPOSE profiles=telegram up -d jht-telegram" in host.log.read_text()
    assert not (host.runtime / "integrations" / "telegram.pending").exists()


def test_add_google_runs_the_fixed_text_in_the_team_container_and_leaves_a_marker(host):
    result = run(host, "add google --json")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["state"] == "ready"
    exec_lines = [line for line in host.log.read_text().splitlines() if line.startswith("DOCKER exec")]
    assert len(exec_lines) == 1
    assert "agent-id python3 -c import sys;" in exec_lines[0] and "GOOGLE_DRIVE" in exec_lines[0] and "GOOGLE_SHEETS" in exec_lines[0]
    assert states(run(host, "list --json"))["google"]["state"] == "ready"


def test_a_failed_add_says_why_in_one_line_and_the_next_status_keeps_it(host):
    result = run(host, "add google --json", {"FAKE_EXEC_FAIL": "1"})
    assert result.returncode == 1
    answer = json.loads(result.stdout)
    assert answer["ok"] is False and answer["state"] == "error" and "No matching distribution" in answer["reason"]
    assert states(run(host, "list --json"))["google"] == {
        "id": "google", "state": "error", "reason": answer["reason"]}
    # the retry that works clears it
    assert run(host, "add google --json").returncode == 0
    assert states(run(host, "list --json"))["google"]["state"] == "ready"


def test_what_is_not_available_yet_is_refused_with_its_own_code_and_touches_nothing(host):
    for name in ("linkedin-login", "screen", "media"):
        for action in ("add", "remove"):
            result = run(host, f"{action} {name} --json")
            assert result.returncode == 3, (name, action, result.stderr)
            assert json.loads(result.stdout)["reason"] == "non disponibile ancora"
    assert host.log.read_text() == ""


@pytest.mark.parametrize("hostile", ["google;touch HIT", "../x", "$(touch HIT)", "Google", "", "all", "-x"])
def test_an_id_outside_the_closed_list_stops_before_any_engine_call(host, hostile):
    result = run(host, f"add '{hostile}'")
    assert result.returncode == 2
    assert not (host.tmp / "HIT").exists() and not Path("HIT").exists()
    assert host.log.read_text() == ""


@pytest.mark.parametrize("args", ["", "frob", "list google", "add", "add google mail", "status google mail", "add google --purge",
                                  "remove telegram --yes", "remove telegram --purge", "list --nope"])
def test_wrong_use_is_a_usage_error(host, args):
    result = run(host, args)
    assert result.returncode == 2, (args, result.stdout, result.stderr)
    assert host.log.read_text() == ""


def test_remove_keeps_the_data_unless_the_person_purges_with_yes(host):
    host.running.write_text("jht-telegram\n")
    host.volumes.write_text("jht_jht-telegram-secrets\njht_jht-telegram-state\njht_jht-telegram-inbox\njht_jht-telegram-sock\njht_jht-secrets\n")
    plain = run(host, "remove telegram --json")
    assert plain.returncode == 0, plain.stderr
    assert "volume rm" not in host.log.read_text()
    assert "stop jht-telegram" in host.log.read_text() and "rm -f jht-telegram" in host.log.read_text()
    purged = run(host, "remove telegram --purge --yes --json")
    assert purged.returncode == 0, purged.stderr
    left = host.volumes.read_text().split()
    # the three volumes of Telegram only; the socket shared with jht and the mail secrets stay
    assert left == ["jht_jht-telegram-sock", "jht_jht-secrets"]


def test_the_mail_broker_is_not_removable_while_jht_up_starts_it(host):
    result = run(host, "remove mail --json")
    assert result.returncode == 3
    assert "stop" not in host.log.read_text()
    host.compose.write_text(host.compose.read_text().replace("  jht-broker:\n", "  jht-broker:\n    profiles: [broker]\n"))
    (host.runtime / ".broker-made").write_text("")
    assert run(host, "remove mail --json").returncode == 0
    assert "COMPOSE profiles=broker stop jht-broker" in host.log.read_text()
    assert not (host.runtime / ".broker-made").exists()  # `jht up` does not bring it back


def test_add_mail_makes_the_broker_with_the_step_that_makes_it_and_checks_it_runs(host):
    result = run(host, "add mail --json")
    assert result.returncode == 0, result.stderr
    assert "COMPOSE profiles=broker up -d jht-broker" in host.log.read_text()
    assert json.loads(result.stdout)["state"] == "running"
    failing = run(host, "add mail --json", {"FAKE_COMPOSE_FAIL": "1"})
    assert failing.returncode == 1 and json.loads(failing.stdout)["state"] == "error"


def test_a_run_in_progress_reads_downloading_and_a_dead_one_is_ignored(host):
    folder = host.runtime / "integrations"
    folder.mkdir(mode=0o700)
    (folder / "google.pending").write_text(f"{os.getpid()}\n")
    assert states(run(host, "list --json"))["google"]["state"] == "downloading"
    (folder / "google.pending").write_text("999999\n")
    assert states(run(host, "list --json"))["google"]["state"] == "not_installed"


def test_the_marker_folder_must_be_the_hosts_own(host):
    elsewhere = host.tmp / "elsewhere"
    elsewhere.mkdir()
    (host.runtime / "integrations").symlink_to(elsewhere)
    result = run(host, "add telegram --json")
    assert result.returncode == 1
    assert "COMPOSE" not in host.log.read_text()
    assert list(elsewhere.iterdir()) == []


def test_a_reason_from_a_command_is_ascii_one_line_and_escaped_in_the_json(host):
    result = run(host, "add google --json", {"FAKE_EXEC_FAIL": "1"})
    json.loads(result.stdout)  # still valid JSON
    assert "\n" not in result.stdout.strip()


# ── the wrapper side: attestation and installer ───────────────────────────
HELPER_FUNCTIONS = ("runtime_stat", "runtime_node_safe", "runtime_sha256", "runtime_helper_digest", "runtime_helpers_write_manifest",
                    "runtime_helpers_trusted")


def _helper_script(runtime: Path, body: str) -> subprocess.CompletedProcess:
    script = f"""
set -euo pipefail
HOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"
RUNTIME_DIR="{runtime}"; RUNTIME_HELPERS="jht-integration.sh"; RUNTIME_HELPERS_MANIFEST="{runtime}/.runtime-helpers"
err() {{ echo "error: $*" >&2; }}
{wrapper_functions(*HELPER_FUNCTIONS, "runtime_helper_load")}
{body}
"""
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)


def test_the_wrapper_refuses_a_helper_that_changed_after_its_manifest_was_written(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700)
    helper = runtime / "jht-integration.sh"
    helper.write_text("# JHT_RUNTIME_HELPER=1\n")
    helper.chmod(0o700)
    out = _helper_script(runtime, f"""
runtime_helpers_trusted && echo none-listed-ok
runtime_helpers_write_manifest
sed 's/=.*/=<sha>/' "$RUNTIME_HELPERS_MANIFEST"
runtime_helpers_trusted && echo trusted
echo '# changed' >> "{helper}"
if runtime_helpers_trusted; then echo STILL-TRUSTED; else echo refused; fi
""")
    assert out.returncode == 0, out.stderr
    assert out.stdout.split() == ["none-listed-ok", "jht-integration.sh=<sha>", "trusted", "refused"]
    assert not (runtime / ".runtime-integrity").exists()      # the main manifest is the app's, it never gets this key


def test_a_helper_that_is_not_in_the_helpers_manifest_is_not_loaded_but_breaks_nothing(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700)
    (runtime / "jht-integration.sh").write_text("echo PLANTED\n")
    out = _helper_script(runtime, """
runtime_helpers_trusted && echo bundle-ok
[ -z "$(runtime_helper_digest jht-integration.sh)" ] && echo not-declared
runtime_helper_load jht-integration.sh list 2>&1 || echo refused
""")
    assert out.stdout.split()[:3] == ["bundle-ok", "not-declared", "error:"] and "refused" in out.stdout and "PLANTED" not in out.stdout


@pytest.mark.parametrize(("command", "fetches"), [("list", False), ("status", False), ("", False), ("add", True), ("remove", True)])
def test_only_add_and_remove_fetch_a_missing_helper(tmp_path, command, fetches):
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700)
    out = _helper_script(runtime, f"""
runtime_helpers_install() {{ echo FETCH; return 1; }}
runtime_helper_load jht-integration.sh '{command}' || true
""")
    assert ("FETCH" in out.stdout) is fetches


def test_purging_the_mail_broker_leaves_the_volume_of_all_the_portal_credentials(host):
    host.compose.write_text(host.compose.read_text().replace("  jht-broker:\n", "  jht-broker:\n    profiles: [broker]\n"))
    host.volumes.write_text("jht_jht-secrets\njht_jht-broker-state\njht_jht-broker-sock\n")
    result = run(host, "remove mail --purge --yes --json")
    assert result.returncode == 0, result.stderr
    assert host.volumes.read_text().split() == ["jht_jht-secrets", "jht_jht-broker-sock"]
    assert "jht reset --scope creds" in json.loads(result.stdout)["reason"]


def test_wrapper_installer_and_library_agree_on_the_helper():
    wrapper = WRAPPER.read_text(encoding="utf-8")
    installer = INSTALLER.read_text(encoding="utf-8")
    lists = [re.search(r'^RUNTIME_HELPERS="([^"]*)"', text, re.M).group(1) for text in (wrapper, installer)]
    assert lists[0] == lists[1] == "jht-integration.sh jht-tools.sh"
    assert LIBRARY.read_text(encoding="utf-8").count("\n# JHT_RUNTIME_HELPER=1\n") == 1
    assert "JHT_INTEGRATION_PROTOCOL=1\n" in wrapper
    assert re.search(r'^  integration\)\n    require_compose_file\n    runtime_helper_load jht-integration\.sh "\$\{2:-\}" \|\| exit 1\n', wrapper, re.M)
    assert re.search(r"\|mail\|telegram\|integration\|tools\|", wrapper)  # its help is the local one: no engine started by --help
    assert '.runtime-helpers' in installer and 'printf \'%s\' "$helper_lines" > "$RUNTIME_DIR/.runtime-helpers.tmp"' in installer
    assert "jht-integration.sh=" not in installer.split("printf 'version=1")[1].split("} > \"$manifest_tmp\"")[0]
    public = (ROOT / "web" / "public" / "install.sh").read_text(encoding="utf-8")
    assert public == installer


def test_the_library_takes_no_shell_path_from_the_person():
    text = LIBRARY.read_text(encoding="utf-8")
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert not re.search(r"\b(eval|bash -c|sh -c)\b", code)
    # the only docker exec is the fixed Google text
    assert len(re.findall(r"docker exec", code)) == 1 and '"$INTEGRATION_GOOGLE_CODE"' in code


def test_add_google_without_credentials_says_added_and_what_is_missing_not_ready(host):
    """D4 of the 10/11 test: «pronto» for libraries nobody can use without a Google account was a promise the integration did not keep."""
    plain = run(host, "add google")
    assert plain.returncode == 0, plain.stderr
    said = plain.stdout + plain.stderr
    assert "aggiunto" in said and "mancano le credenziali" in said
    assert "pronto" not in said
    row = json.loads(run(host, "status google --json").stdout)
    assert row["state"] == "ready" and "mancano le credenziali" in row["reason"]
