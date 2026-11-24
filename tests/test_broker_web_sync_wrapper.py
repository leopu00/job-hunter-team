"""The host tells the broker whether the website sync is on, and tells it again after every command that changes it.

The broker cannot read the box's cloud.json, so `broker_configure_web_sync` (sh) and `Get-AgentBrokerSyncMode` (ps1) read
it in the box, ask the one rule (cli/src/lib/cloud-sync-pause.js: brokerSyncMode, on top of sync-switch.js), and hand the
broker one word. The sh function runs here against a fake `docker` that executes the very script it is given with the
real node, on a synthetic cloud.json. Synthetic data only, offline.
"""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SH = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
PS1 = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


def _function(text: str, name: str) -> str:
    match = re.search(rf"^{re.escape(name)}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
    assert match, f"{name} is not in the wrapper"
    return match.group(0)


FAKE_DOCKER = r"""
docker() {
  printf '%s\n' "$*" >> "$T_LOG"
  if [ "$1 $2 $3 $4 $5 $6" = "exec -u 1001 agent node -e" ]; then
    [ "${T_NODE_FAIL:-0}" = 1 ] && return 1
    local script="$7"
    script="${script//\/jht_home/$T_HOME}"
    script="${script//\/app\/cli/$T_CLI}"
    node -e "$script"
    return
  fi
  return 0
}
"""


def run_configure(tmp_path, config, env=None, node_fail=False):
    home = tmp_path / "home"
    home.mkdir()
    if config is not None:
        (home / "cloud.json").write_text(json.dumps(config), encoding="utf-8")
    log = tmp_path / "log"
    log.write_text("")
    script = FAKE_DOCKER + _function(SH, "broker_configure_web_sync") + "\nbroker_configure_web_sync agent broker\n"
    subprocess.run(
        ["bash", "-c", script], check=True, capture_output=True, text=True, timeout=60,
        env={**os.environ, "T_LOG": str(log), "T_HOME": str(home), "T_CLI": str(ROOT / "cli"),
             "T_NODE_FAIL": "1" if node_fail else "0", "JHT_CLOUD_SYNC": "", **(env or {})},
    )
    return [line for line in log.read_text().splitlines() if "jht-broker-admin" in line]


PAIRED = {"base_url": "https://example.invalid", "token": "jht_sync_exampleexampleexample"}


@needs_node
@pytest.mark.parametrize("config, env, word", [
    ({**PAIRED, "enabled": True, "sync_choice": "user"}, {}, "on"),                      # resumed by the person
    ({**PAIRED, "enabled": False, "paused_at": "2026-11-24T10:00:00.000Z", "sync_choice": "user"}, {}, "off"),
    ({**PAIRED, "enabled": False, "paused_at": "2026-11-24T10:00:00.000Z", "sync_choice": "migrated"}, {}, "off"),
    # the migration has not run yet in the container: the broker is told what the migration is about to make of it
    ({**PAIRED, "enabled": True}, {}, "off"),
    ({**PAIRED, "enabled": True, "sync_choice": "user"}, {"JHT_CLOUD_SYNC": "0"}, "off"),  # the variable wins
    (None, {}, "off"),                                                                    # no file
])
def test_the_broker_gets_the_word_of_the_switch_of_the_box(tmp_path, config, env, word):
    assert run_configure(tmp_path, config, env) == [f"exec broker jht-broker-admin apply web-sync {word}"]


@needs_node
def test_a_box_that_cannot_be_read_leaves_the_broker_off(tmp_path):
    assert run_configure(tmp_path, {**PAIRED, "enabled": True, "sync_choice": "user"}, node_fail=True) == [
        "exec broker jht-broker-admin apply web-sync off"]


def test_the_start_of_the_team_and_the_commands_that_change_the_switch_configure_the_broker():
    configure = _function(SH, "broker_configure_web_authorisations")
    assert 'broker_configure_web_sync "$agent_id" "$broker_id"' in configure
    default_branch = SH[SH.rindex("\n  *)\n    require_compose_file"):]
    assert "pause|resume|enable|login|disable) broker_configure_web_authorisations" in default_branch
    # not `pair`, and not made here: the function returns quietly when there is no broker
    assert "ensure_broker" not in default_branch
    assert 'exit "$rc"' in default_branch


def test_the_windows_wrapper_does_the_same():
    init = re.search(r"^function Initialize-BrokerWebAuthorisations \{\n.*?^\}\n", PS1, re.S | re.M).group(0)
    assert "Get-AgentBrokerSyncMode -AgentId $agentId" in init
    assert "apply web-sync $syncMode" in init
    assert init.index("web-token") < init.index("web-sync")
    reader = re.search(r"^function Get-AgentBrokerSyncMode \{\n.*?^\}\n", PS1, re.S | re.M).group(0)
    assert "brokerSyncMode" in reader and "docker exec -i -u 1001 $AgentId node -" in reader  # stdin: no quotes through 5.1
    assert "return 'off'" in reader
    assert "@('pause', 'resume', 'enable', 'login', 'disable') -contains $Rest[0] -and $code -eq 0) { Initialize-BrokerWebAuthorisations }" in PS1
