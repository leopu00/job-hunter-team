"""Real native transport stdin: planning must not consume the pairing input."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys

import pytest

from test_telegram_lifecycle import BASH_TRANSPORT, PS_TRANSPORT, PLANNER, ROOT, lifecycle_home
from test_telegram_pairing_wrapper import functions, powershell_functions


ENGINE = r'''
import json, os, subprocess, sys
from pathlib import Path
args = sys.argv[1:]
state = Path(os.environ['ENGINE_STATE'])
if args[0] == 'inspect':
    print(state.read_text() if state.exists() else 'false')
    raise SystemExit(0)
if 'run' in args:
    payload = sys.stdin.read()
    index = args.index('-I')
    command = args[index + 2:]
    with open(os.environ['INPUT_OBSERVATIONS'], 'a') as log:
        log.write(json.dumps({'phase': command[0], 'stdin_bytes': len(payload.encode())}) + '\n')
    raise SystemExit(subprocess.run([sys.executable, '-I', os.environ['PLANNER'], *command], input=payload, text=True).returncode)
if 'up' in args:
    state.write_text('true')
elif 'stop' in args:
    state.write_text('false')
else:
    raise SystemExit(98)
'''


def source_for(language, mutant):
    if language == "bash":
        adapter = re.sub(r'^compose\(\) \{\n.*?^\}\n', 'compose() { "$NATIVE_DOCKER" compose "$@"; }\n', BASH_TRANSPORT, count=1, flags=re.M | re.S)
        fake_docker = 'docker() { cat "$ENGINE_STATE"; }'
        assert adapter.count(fake_docker) == 1
        adapter = adapter.replace(fake_docker, 'docker() { "$NATIVE_DOCKER" "$@"; }')
        adapter += '\ntelegram_pair() { [ "$(cat)" = "$PAIR_INPUT" ] || return 91; "$PYTHON" "$MUTATE" pair "$1"; }\n'
        source = functions("telegram_lifecycle_plan", "telegram_lifecycle_verify", "telegram_lifecycle_steps", "telegram_lifecycle_command")
        if mutant:
            assert source.count(' </dev/null') == 1
            source = source.replace(' </dev/null', '')
        return adapter + '\nTELEGRAM_SERVICE=jht-telegram\n' + source + '\ntelegram_lifecycle_command pair assistente\n'
    actual = powershell_functions("Invoke-Compose")
    if mutant:
        # the line goes through Invoke-NativeWithStdin (no BOM in front of what is piped): the mutant drops the `$null |` inside it
        old = 'elseif ($NoInput) { Invoke-NativeWithStdin { $null | & docker compose'
        assert actual.count(old) == 1
        actual = actual.replace(old, 'elseif ($NoInput) { Invoke-NativeWithStdin { & docker compose')
    adapter = re.sub(r'^function Invoke-Compose \{\n.*?^\}\n', lambda _: actual, PS_TRANSPORT, count=1, flags=re.M | re.S)
    adapter, removed = re.subn(r'^function docker \{[^\n]+\}\n', '', adapter, count=1, flags=re.M)
    assert removed == 1
    adapter += r'''
$JhtHome = $env:JHT_TELEGRAM_STATE
$ComposeFile = 'synthetic.yml'; $RuntimeDir = '.'; $ContainerRuntime = 'docker'
function Test-PrivateJhtHomeAcl { return $true }
function Assert-TrustedRuntime {}
function Invoke-TelegramPair {
  param([string]$Role)
  if ([Console]::In.ReadToEnd() -cne $env:PAIR_INPUT) { return 91 }
  & $env:PYTHON $env:MUTATE 'pair' $Role | Out-Host
  return $LASTEXITCODE
}
'''
    source = powershell_functions("Get-TelegramLifecyclePlan", "Confirm-TelegramLifecycle", "Invoke-ComposeQuiet", "Invoke-TelegramLifecycleSteps", "Invoke-TelegramLifecycle")
    return adapter + source + '\nexit (Invoke-TelegramLifecycle @(\'pair\', \'assistente\'))\n'


def run_native_pair(home, language, mutant):
    binary_dir = home / "bin"
    binary_dir.mkdir()
    engine = binary_dir / "docker"
    engine.write_text('#!' + sys.executable + '\n' + ENGINE, encoding="utf-8")
    engine.chmod(0o700)
    mutate = home / "mutate.py"
    mutate.write_text(
        'import sys\nsys.path.insert(0, ' + repr(str(ROOT)) + ')\n'
        'from shared.telegram_service import store\n'
        "store.write_bot(sys.argv[2], {'bot_token':'synthetic-only','chat_id':'12345'})\n", encoding="utf-8",
    )
    observations = home / "observations.jsonl"
    env = {**os.environ, "PATH": str(binary_dir) + os.pathsep + os.environ["PATH"],
           "NATIVE_DOCKER": str(engine), "PLANNER": str(PLANNER), "PYTHON": sys.executable,
           "MUTATE": str(mutate), "ENGINE_STATE": str(home / "state.txt"),
           "EVENTS": str(home / "events"), "INPUT_OBSERVATIONS": str(observations),
           "PAIR_INPUT": '{"bot_token":"synthetic-only"}'}
    script = home / ("host.sh" if language == "bash" else "host.ps1")
    script.write_text(source_for(language, mutant), encoding="utf-8")
    command = ["bash", str(script)] if language == "bash" else ["pwsh", "-NoProfile", "-File", str(script)]
    result = subprocess.run(command, env=env, input=env["PAIR_INPUT"], text=True, capture_output=True, timeout=30)
    records = [json.loads(line) for line in observations.read_text().splitlines()]
    return result, records


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_native_planning_preserves_the_pairing_stdin(lifecycle_home, language):
    result, records = run_native_pair(lifecycle_home, language, False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert records and any(row["phase"] == "verify" and row["stdin_bytes"] > 0 for row in records)
    assert all(row["stdin_bytes"] == 0 for row in records if row["phase"] in ("prepare", "complete"))


@pytest.mark.parametrize("language", ["bash", "pwsh"])
def test_removing_the_actual_input_isolation_loses_the_token_and_fails(lifecycle_home, language):
    result, records = run_native_pair(lifecycle_home, language, True)
    assert result.returncode == 91, result.stdout + result.stderr
    assert any(row["phase"] == "prepare" and row["stdin_bytes"] > 0 for row in records)
