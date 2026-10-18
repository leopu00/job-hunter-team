"""`jht team start` sotto il 3% di disco: rifiuta con `disk_low`, davvero.

Il comando gira per davvero (Node, il codice vero di cli/src) contro un `docker`
e un `tmux` finti sul PATH, con `fs.statfsSync` finto. Niente container, niente
tmux vero, niente motore. `picocolors` (l'unica dipendenza che la CLI importa
qui) e' sostituito da un modulo vuoto in una COPIA della CLI: la suite non ha
bisogno di node_modules.

- 15% libero: l'avvio parte (start-agent.sh viene chiamato);
- 2%: nessun avvio, codice `disk_low` e la frase della tabella, exit 1, e le
  sincronizzazioni cloud del bootstrap non partono;
- 2% con la sessione gia' viva: resta com'e' ("already active"), nessun rifiuto.

Run with: pytest tests/test_disk_guard_team_start.py -v
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node non disponibile")

PICOCOLORS_STUB = """
const id = (value) => String(value);
const colors = new Proxy({ isColorSupported: false }, { get: (target, key) => (key in target ? target[key] : id) });
export default { isColorSupported: false, createColors: () => colors };
"""

FAKE_STATFS = """
import fs from 'node:fs';
const spec = JSON.parse(process.env.FAKE_STATFS || '{}');
fs.statfsSync = (target) => {
  const p = String(target);
  let best = '';
  let pct = spec.default ?? 50;
  for (const [prefix, value] of Object.entries(spec.paths || {})) {
    if ((p === prefix || p.startsWith(prefix.replace(/\\/+$/, '') + '/')) && prefix.length >= best.length) {
      best = prefix;
      pct = value;
    }
  }
  const blocks = 1000000;
  return { bsize: 4096, blocks, bfree: Math.floor(blocks * pct / 100), bavail: Math.floor(blocks * pct / 100) };
};
"""

DRIVER = """
import { startAction } from './cli/src/commands/team/start.js';
await startAction(process.env.AGENT_ARG || undefined, { mode: 'default' });
"""

FAKE_DOCKER = """#!/bin/sh
echo "docker $*" >> "$FAKE_LOG"
case "$1" in
  --version) exit 0 ;;
  ps) [ "${FAKE_CONTAINER:-1}" = 1 ] && echo jht; exit 0 ;;
  exec)
    case "$*" in
      *start-agent.sh*) echo "SPAWN $*" >> "$FAKE_LOG"; exit 0 ;;
      *list-sessions*) printf '%s' "$FAKE_SESSIONS"; exit 0 ;;
    esac
    exit 0 ;;
esac
exit 0
"""

FAKE_TMUX = """#!/bin/sh
echo "tmux $*" >> "$FAKE_LOG"
case "$1" in
  list-sessions) printf '%s' "$FAKE_SESSIONS"; exit 0 ;;
  has-session) exit 1 ;;
esac
exit 0
"""


@pytest.fixture(scope="module")
def cli_copy(tmp_path_factory):
    pkg = tmp_path_factory.mktemp("cli-copy")
    shutil.copytree(ROOT / "cli" / "src", pkg / "cli" / "src")
    shutil.copytree(ROOT / "cli" / "wizard", pkg / "cli" / "wizard")
    shutil.copy(ROOT / "cli" / "package.json", pkg / "cli" / "package.json")
    shutil.copytree(ROOT / "shared" / "runtime", pkg / "shared" / "runtime")
    shutil.copytree(ROOT / "shared" / "locales", pkg / "shared" / "locales")
    stub = pkg / "cli" / "node_modules" / "picocolors"
    stub.mkdir(parents=True)
    (stub / "package.json").write_text('{"name":"picocolors","type":"module","main":"index.js"}', encoding="utf-8")
    (stub / "index.js").write_text(PICOCOLORS_STUB, encoding="utf-8")
    (pkg / "fake-statfs.mjs").write_text(FAKE_STATFS, encoding="utf-8")
    (pkg / "driver.mjs").write_text(DRIVER, encoding="utf-8")
    # il driver sta nella radice della copia e importa ./cli/src: serve il package della CLI
    (pkg / "package.json").write_text('{"type":"module"}', encoding="utf-8")
    return pkg


def run_start(cli_copy, tmp_path, pct, agent="scout:1", container=True, sessions=""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name, body in (("docker", FAKE_DOCKER), ("tmux", FAKE_TMUX), ("claude", "#!/bin/sh\nexit 0\n")):
        (bin_dir / name).write_text(body, encoding="utf-8")
        (bin_dir / name).chmod(0o755)
    home, engine = tmp_path / "home", tmp_path / "engine"
    home.mkdir(exist_ok=True)
    engine.mkdir(exist_ok=True)
    log = tmp_path / "calls.log"
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "JHT_HOME": str(home),
        "JHT_USER_DIR": str(tmp_path / "docs"),
        "JHT_ENGINE_DISK_PATH": str(engine),
        "JHT_LANG": "en",
        "FAKE_LOG": str(log),
        "FAKE_CONTAINER": "1" if container else "0",
        "FAKE_SESSIONS": sessions,
        "FAKE_STATFS": json.dumps({"default": 50, "paths": {str(home): pct, str(engine): pct}}),
        "AGENT_ARG": agent or "",
        "NO_COLOR": "1",
    }
    done = subprocess.run(
        [NODE, "--import", str(cli_copy / "fake-statfs.mjs"), str(cli_copy / "driver.mjs")],
        cwd=cli_copy, env=env, capture_output=True, text=True, timeout=60,
    )
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, calls


def spawned(calls):
    return [call for call in calls if call.startswith("SPAWN")]


def disk_low_phrase(shown):
    table = json.loads((ROOT / "shared" / "locales" / "en.json").read_text(encoding="utf-8"))
    return table["disk.low"].replace("%s", shown)


def test_at_15_percent_one_agent_starts_as_before(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 15)
    assert done.returncode == 0, done.stdout + done.stderr
    assert len(spawned(calls)) == 1 and "start-agent.sh scout 1" in spawned(calls)[0]
    assert "disk_low" not in done.stdout + done.stderr


def test_at_8_percent_the_start_is_still_allowed(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 8)
    assert done.returncode == 0, done.stdout + done.stderr
    assert len(spawned(calls)) == 1


def test_at_2_percent_a_single_start_is_refused_with_the_code_and_the_table_phrase(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 2)
    assert done.returncode == 1, done.stdout + done.stderr
    assert f"disk_low: {disk_low_phrase('2%')}" in done.stdout
    assert spawned(calls) == []
    assert "0 started" in done.stdout and "1 errors" in done.stdout


def test_at_2_percent_the_whole_team_start_launches_and_syncs_nothing(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 2, agent="")
    assert done.returncode == 1, done.stdout + done.stderr
    assert f"disk_low: {disk_low_phrase('2%')}" in done.stdout
    assert spawned(calls) == []
    assert not any("cloud" in call for call in calls), calls


def test_at_2_percent_an_agent_already_running_is_left_alone(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 2, sessions="SCOUT-1\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "SCOUT-1 — already active" in done.stdout
    assert "disk_low" not in done.stdout
    assert spawned(calls) == []
    assert not any("kill" in call for call in calls), calls


def test_at_2_percent_a_running_team_start_is_still_the_idempotent_no_op(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 2, agent="", sessions="ASSISTENTE\nSENTINELLA\nMENTOR\nCAPITANO\n")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "4 already active" in done.stdout and "disk_low" not in done.stdout
    assert spawned(calls) == []


def test_without_the_container_the_host_tmux_start_is_refused_too(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 2, container=False)
    assert done.returncode == 1, done.stdout + done.stderr
    assert "disk_low" in done.stdout
    assert not any(call.startswith("tmux new-session") for call in calls), calls


def test_without_the_container_the_host_tmux_start_goes_on_at_15_percent(cli_copy, tmp_path):
    done, calls = run_start(cli_copy, tmp_path, 15, container=False)
    assert done.returncode == 0, done.stdout + done.stderr
    assert any(call.startswith("tmux new-session") for call in calls), calls
