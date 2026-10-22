"""Native Podman on Linux: the wrapper's checks ask this user's local Podman.

Podman on Linux talks to a remote service only when something turns its remote
mode on (cmd/podman/registry: CONTAINER_HOST or CONTAINER_CONNECTION in the
environment, --remote/--connection/--url/--host, or remote = true in
containers.conf). A default system connection the user set
(`podman system connection default`) is not one of them. The wrapper unsets
both variables before any call, and its probe refuses a client that still
answers as remote (ServiceIsRemote), so `podman info` and `docker info` through
the shim never report on another server's Podman.

The fake podman below follows that rule and logs every call it receives.
"""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"

FAKE_PODMAN = r"""#!/bin/bash
remote=""
[ -n "${CONTAINER_HOST+x}" ] && remote=1
[ -n "${CONTAINER_CONNECTION+x}" ] && remote=1
case "$1" in --remote|-r|--connection|-c|--url|--host|-H) remote=1 ;; esac
grep -qsE '^[[:space:]]*remote[[:space:]]*=[[:space:]]*true' "${CONTAINERS_CONF:-/nonexistent}" && remote=1
echo "${remote:+remote }podman $*" >> "$FAKE_LOG"
case "$1" in
  info) if [ -n "$remote" ]; then echo "false true"; else echo "true false"; fi ;;
esac
"""


def _block() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    top = re.search(r'^if \[ "\$CONTAINER_RUNTIME" = "podman" \]; then\n.*?^fi\n', text, re.S | re.M)
    assert top, "the wrapper's Podman runtime block"
    out = [top.group(0)]
    for fn in ("podman_binary", "podman_native_rootless", "require_rootless_podman_native"):
        match = re.search(rf"^{fn}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, fn
        out.append(match.group(0))
    return "\n".join(out)


@pytest.fixture()
def box(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "podman").write_text(FAKE_PODMAN)
    (bin_dir / "podman").chmod(0o755)
    # the shim the wrapper puts first on PATH: docker info is podman info
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    (adapter / "docker").write_text(f'#!/bin/bash\nexec "{bin_dir / "podman"}" "$@"\n')
    (adapter / "docker").chmod(0o755)
    # a default system connection to another server, as `podman system connection default` leaves it
    config = tmp_path / "config"
    (config / "containers").mkdir(parents=True)
    (config / "containers" / "podman-connections.json").write_text(json.dumps({
        "Connection": {"Default": "elsewhere", "Connections": {
            "elsewhere": {"URI": "ssh://other@192.0.2.20/run/user/0/podman/podman.sock"}}},
    }))
    log = tmp_path / "podman.log"

    def run(extra_env: dict, body: str = "require_rootless_podman_native\ndocker info >/dev/null\necho done\n"):
        script = (
            'err() { echo "error: $*" >&2; }\n'
            "CONTAINER_RUNTIME=podman HOST_KERNEL=Linux HOST_UID=1000\n"
            f'PODMAN_MACHINE_FILE="{tmp_path / "no-machine"}" PODMAN_MACHINE_OVERRIDE=""\n'
            f'PODMAN_ADAPTER_BIN="{adapter}" PODMAN_MACHINE_NAME="" err_runtime=""\n'
            + _block()
            + body
        )
        env = {
            **{k: v for k, v in os.environ.items() if k not in ("CONTAINER_HOST", "CONTAINER_CONNECTION", "CONTAINERS_CONF")},
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "XDG_CONFIG_HOME": str(config),
            "FAKE_LOG": str(log),
            **extra_env,
        }
        done = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=30)
        return done, (log.read_text().splitlines() if log.exists() else [])

    return run


@pytest.mark.parametrize("inherited", [
    {},
    {"CONTAINER_HOST": "ssh://other@192.0.2.20/run/user/0/podman/podman.sock"},
    {"CONTAINER_CONNECTION": "elsewhere"},
    {"CONTAINER_HOST": "", "CONTAINER_CONNECTION": ""},
])
def test_with_a_remote_default_and_remote_variables_the_native_checks_go_to_the_local_podman(box, inherited):
    done, calls = box(inherited)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "done"
    assert calls == [
        "podman info --format {{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}",
        "podman info",
    ]


def test_a_client_set_to_remote_in_containers_conf_is_refused_with_its_code(box, tmp_path):
    conf = tmp_path / "containers.conf"
    conf.write_text("[engine]\nremote = true\n")
    done, calls = box({"CONTAINERS_CONF": str(conf)})
    assert done.returncode == 1
    assert "podman_remote_service_refused" in done.stderr
    assert "done" not in done.stdout
    # one question to the client, and nothing after the refusal
    assert calls == ["remote podman info --format {{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}"]
