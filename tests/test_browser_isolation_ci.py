"""The P2-3 gate (scripts/ci/browser_isolation.py), without containers.

The gate runs only in CI on a real Linux, under Docker and rootless Podman.
Here its verdict is checked on faked measurements: design S (Chromium uid
1004 in its own container) passes; today's design (Chromium uid 1002 in
the broker's container) fails exactly with the declared red; every broken
fact fails with its own tag; and the parsers read what ss, mountinfo,
uid_map and websockify really print.

Run with: pytest tests/test_browser_isolation_ci.py -v
"""

import base64
import copy
import importlib.util
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("browser_isolation", ROOT / "scripts" / "ci" / "browser_isolation.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

VOLUMES = [
    {"volume": "jht-secrets", "name": "jhtisolation_jht-secrets", "destination": "/jht_secrets",
     "source": "/var/lib/docker/volumes/jhtisolation_jht-secrets/_data"},
    {"volume": "jht-broker-state", "name": "jhtisolation_jht-broker-state", "destination": "/jht_broker_state",
     "source": "/var/lib/docker/volumes/jhtisolation_jht-broker-state/_data"},
    {"volume": "jht-broker-sock", "name": "jhtisolation_jht-broker-sock", "destination": "/run/jht-broker",
     "source": "/var/lib/docker/volumes/jhtisolation_jht-broker-sock/_data"},
]
BROKER_MOUNTINFO = [
    "812 790 8:1 /var/lib/docker/volumes/jhtisolation_jht-secrets/_data /jht_secrets rw,relatime - ext4 /dev/root rw",
    "813 790 8:1 /var/lib/docker/volumes/jhtisolation_jht-broker-state/_data /jht_broker_state rw - ext4 /dev/root rw",
    "814 790 8:1 /var/lib/docker/volumes/jhtisolation_jht-broker-sock/_data /run/jht-broker rw - ext4 /dev/root rw",
]
TWIN_MOUNTINFO = [
    "912 890 8:1 /var/lib/docker/volumes/jhtisolation_jht-browser-profile/_data /jht_browser_profile rw - ext4 /dev/root rw",
]
IDENTITY = [(0, 0, 4294967295)]


def _frame(payload: bytes) -> str:
    return base64.b64encode(bytes([0x82, len(payload)]) + payload).decode()


RFB = {"status": "HTTP/1.1 101 Switching Protocols", "body_b64": _frame(b"RFB 003.008\n")}
DEAD = {"status": "HTTP/1.1 101 Switching Protocols", "body_b64": base64.b64encode(b"\x88\x02\x03\xe8").decode()}

# Design S: Chromium uid 1004 in the twin, its own pid namespace, nothing of
# the broker's mounted, the broker on the engine's profiles.
S = {
    "broker": {"pid": 4100, "host_uid": 1002, "uid": 1002, "uid_map": IDENTITY, "pidns": "pid:[4026532300]",
               "volumes": VOLUMES},
    "chromium": {"pid": 5100, "host_uid": 1004, "uid": 1004, "uid_map": IDENTITY, "pidns": "pid:[4026532400]"},
    "attack": {
        "uid": 1004, "gid": 1004, "broker_pids_visible": [],
        "reads": {"jht-secrets": [], "jht-broker-state": []},
        "ptrace": [], "proc_reads": [], "signals": [], "ptrace_own_child": True,
        "agent_socket": [{"path": "/run/jht-broker/broker.sock", "error": "FileNotFoundError"}],
        "websockify_no_token": DEAD, "websockify_wrong_token": DEAD,
        "mountinfo": TWIN_MOUNTINFO, "unshare_user": True,
        # The twin's x11vnc on a random port, with a password; websockify and
        # the launcher do not speak RFB.
        "vnc": [{"local": "127.0.0.1:41234", "rfb": True, "version": "RFB 003.008", "types": [2]},
                {"local": "0.0.0.0:6081", "rfb": False}, {"local": "127.0.0.1:6082", "rfb": False}],
    },
    "broker_side": {"uid": 1002, "canaries": {"/jht_secrets/.isolation-canary": True,
                                              "/jht_broker_state/.isolation-canary": True},
                    "sockets": {"/run/jht-broker": True}, "unshare_user": False, "mountinfo": BROKER_MOUNTINFO,
                    "legacy_profile": False},
    "broker_listeners": [], "unattributed_listeners": [],
    "websockify_listening": True, "websockify_control": RFB,
    "declared_vnc": "127.0.0.1:41234",
    "browser_profile": {"volume": "jhtisolation_jht-browser-profile", "marker": gate.MARKER_TEXT,
                        "files": ["Default/Cookies", "Default/jht-gate-marker", "Local State"]},
}

# Today's design: Chromium is uid 1002 in the broker's own container.
TODAY = copy.deepcopy(S)
TODAY["chromium"].update(host_uid=1002, uid=1002, pidns="pid:[4026532300]")
TODAY["attack"].update(
    uid=1002, gid=1002, broker_pids_visible=[7, 31, 58],
    reads={"jht-secrets": ["/jht_secrets/.isolation-canary", "/jht_secrets/linkedin-profile/Local State"],
           "jht-broker-state": ["/jht_broker_state/.isolation-canary"]},
    proc_reads=["7/environ", "7/maps", "7/fd"], signals=["7/0", "7/28"],
    agent_socket=[{"path": "/run/jht-broker/broker.sock", "answer": '{"ok": false, "reason": "peer_not_allowed"}'}],
    mountinfo=BROKER_MOUNTINFO,
)
TODAY["broker_side"]["unshare_user"] = True
TODAY["broker_side"]["legacy_profile"] = True
# x11vnc -nopw on 127.0.0.1:5901, and on ::1 too (measured, run 37924134385).
TODAY["attack"]["vnc"] = [{"local": "127.0.0.1:5901", "rfb": True, "types": [1]},
                          {"local": "[::1]:5900", "rfb": True, "types": [1]},
                          {"local": "[::1]:5901", "rfb": True, "types": [1]},
                          {"local": "0.0.0.0:6081", "rfb": False}]
TODAY["declared_vnc"] = "127.0.0.1:5901"
TODAY["browser_profile"] = {"volume": None}
TODAY["broker_listeners"] = ["tcp LISTEN 0 32 127.0.0.1:5901 0.0.0.0:* users:((\"x11vnc\",pid=60,fd=7))",
                             "u_str LISTEN 0 4096 @/tmp/.X11-unix/X101 31 * 0 users:((\"Xvfb\",pid=40,fd=5))"]


def _tags(facts, engine="docker"):
    return {tag for tag, _ in gate.verdict(facts, engine)}


def test_design_s_passes_on_both_engines():
    assert gate.verdict(S, "docker") == []
    podman = copy.deepcopy(S)
    podman["broker"]["uid_map"] = [(0, 1001, 1), (1, 100000, 65536)]
    podman["chromium"]["uid_map"] = [(0, 1001, 1), (1, 165536, 65536)]
    assert gate.verdict(podman, "podman") == []


def test_todays_design_is_red_exactly_as_declared():
    assert _tags(TODAY, "docker") == gate.EXPECTED_RED_TODAY["docker"]
    podman = copy.deepcopy(TODAY)
    podman["broker"]["uid_map"] = podman["chromium"]["uid_map"] = [(0, 1001, 1), (1, 100000, 65536)]
    assert _tags(podman, "podman") == gate.EXPECTED_RED_TODAY["podman"]


def _broken(path, value):
    facts = copy.deepcopy(S)
    node = facts
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    return facts


@pytest.mark.parametrize("path,value,tag", [
    (("attack", "reads", "jht-secrets"), ["/proc/31/root/jht_secrets/.isolation-canary"], "secrets"),
    (("attack", "reads", "jht-broker-state"), ["/jht_broker_state/view.json"], "broker-state"),
    (("chromium", "host_uid"), 1002, "chromium-uid"),
    (("chromium", "pidns"), "pid:[4026532300]", "pid-namespace"),
    (("attack", "ptrace"), [31], "ptrace"),
    (("attack", "proc_reads"), ["31/mem"], "proc"),
    (("attack", "signals"), ["31/0"], "signal"),
    (("attack", "agent_socket"), [{"path": "/proc/31/root/run/jht-broker/broker.sock",
                                    "answer": '{"ok": true, "mailbox": "configured"}'}], "agent-socket"),
    (("broker_listeners",), ["tcp LISTEN 0 10 127.0.0.1:9222 0.0.0.0:*"], "loopback"),
    (("unattributed_listeners",), ["tcp LISTEN 0 10 127.0.0.1:7000 0.0.0.0:*"], "loopback"),
    (("websockify_listening",), False, "loopback-control"),
    (("attack", "websockify_no_token"), RFB, "websockify"),
    (("attack", "websockify_wrong_token"), RFB, "websockify"),
    (("websockify_control",), DEAD, "websockify-control"),
    (("websockify_control",), {"error": "ConnectionRefusedError"}, "websockify-control"),
    (("attack", "mountinfo"), BROKER_MOUNTINFO[:1], "mounts"),
    (("broker_side", "mountinfo"), BROKER_MOUNTINFO[:2], "mount-control"),
    (("broker_side", "unshare_user"), True, "broker-userns"),
    (("attack", "unshare_user"), False, "userns-control"),
    (("broker_side", "canaries"), {"/jht_secrets/.isolation-canary": "PermissionError"}, "canary"),
    (("broker_side", "sockets"), {"/run/jht-broker": False}, "socket-control"),
    (("attack", "uid"), 1002, "attacker"),
    (("attack", "vnc"), [{"local": "[::1]:41234", "rfb": True, "types": [2]}], "vnc-address"),
    (("attack", "vnc"), [{"local": "0.0.0.0:41234", "rfb": True, "types": [2]}], "vnc-address"),
    (("attack", "vnc"), [{"local": "127.0.0.1:41234", "rfb": True, "types": [2]},
                         {"local": "127.0.0.1:5900", "rfb": True, "types": [2]}], "vnc-port"),
    (("attack", "vnc"), [{"local": "127.0.0.1:41234", "rfb": True, "types": [1, 2]}], "vnc-nopw"),
    (("attack", "vnc"), [{"local": "127.0.0.1:41234", "rfb": True, "types": None}], "vnc-nopw"),
    (("attack", "vnc"), [{"local": "127.0.0.1:41234", "rfb": False}], "vnc-control"),
    (("declared_vnc",), None, "vnc-control"),
    (("browser_profile",), {"volume": None}, "browser-profile"),
    (("browser_profile", "files"), ["Default/Login Data-journal", "Default/jht-gate-marker"], "profile-copy"),
    (("browser_profile", "files"), ["Default/Account Web Data", "Default/jht-gate-marker"], "profile-copy"),
    (("browser_profile", "files"), ["Default/Login Data For Account-wal"], "profile-copy"),
    (("browser_profile", "marker"), None, "profile-copy-control"),
    (("broker_side", "legacy_profile"), True, "profile-left"),
])
def test_every_broken_fact_fails_with_its_tag(path, value, tag):
    assert tag in _tags(_broken(path, value))


def test_shared_uid_map_under_podman_fails_and_docker_ignores_it():
    facts = copy.deepcopy(S)
    facts["broker"]["uid_map"] = facts["chromium"]["uid_map"] = [(0, 1001, 1), (1, 100000, 65536)]
    assert _tags(facts, "podman") == {"uid-map"}
    assert _tags(facts, "docker") == set()


def test_a_visible_broker_skips_the_pid_namespace_proof_but_not_the_attacks():
    # pid: service:jht-broker would show the broker: then the refusals count.
    facts = _broken(("attack", "broker_pids_visible"), [31])
    facts["chromium"]["pidns"] = facts["broker"]["pidns"]
    assert gate.verdict(facts, "docker") == []


def test_no_answer_is_not_an_answer():
    assert _tags(_broken(("attack",), {"error": "exit 126"})) == {"attack"}
    assert _tags(_broken(("broker_side",), {})) == {"broker-side"}
    assert gate.verdict({"error": "compose up failed"}, "docker") == [("setup", "compose up failed")]


def test_peer_not_allowed_or_no_socket_is_a_refusal():
    for answer in ({"path": "p", "answer": '{"ok": false, "reason": "peer_not_allowed"}'},
                   {"path": "p", "error": "PermissionError"}):
        assert gate.verdict(_broken(("attack", "agent_socket"), [answer]), "docker") == []


def test_roles_not_names():
    assert gate.chromium_browser(["/ms-playwright/chromium-1187/chrome-linux/chrome", "--user-data-dir=/x"])
    assert not gate.chromium_browser(["/ms-playwright/chromium-1187/chrome-linux/chrome", "--type=renderer"])
    # A zygote child with its title rewritten into argv[0].
    assert not gate.chromium_browser(["/ms-playwright/chrome-linux/chrome --type=zygote --no-zygote-sandbox"])
    assert not gate.chromium_browser(["/ms-playwright/chrome-linux/chrome_crashpad_handler", "--database=/tmp"])
    assert gate.broker_serve(["/usr/bin/python3", "/usr/local/bin/jht-broker", "serve"])
    assert not gate.broker_serve(["/usr/bin/tini", "-g", "--", "/usr/local/bin/jht-broker", "serve"])
    assert not gate.broker_serve(["/usr/bin/python3", "/usr/local/bin/jht-broker-admin", "view", "start"])
    assert gate.websockify(["/usr/bin/python3", "-m", "broker.view_ws", "--token-plugin", "x", "0.0.0.0:6081"])


def test_ids_seen_through_a_rootless_map():
    rootless = gate.parse_id_map("         0       1001          1\n         1     100000      65536\n")
    assert rootless == [(0, 1001, 1), (1, 100000, 65536)]
    assert gate.inside_id(101001, rootless) == 1002
    assert gate.inside_id(1001, rootless) == 0
    assert gate.inside_id(200000, rootless) is None
    assert gate.inside_id(1004, IDENTITY) == 1004


def test_ss_lines_and_what_they_expose():
    rows = gate.parse_ss(
        'tcp   LISTEN 0      100          0.0.0.0:6081       0.0.0.0:*    users:(("python3",pid=58,fd=3))\n'
        'tcp   LISTEN 0      32         127.0.0.1:5901       0.0.0.0:*    users:(("x11vnc",pid=60,fd=7))\n'
        'udp   UNCONN 0      0          127.0.0.1:5353       0.0.0.0:*    users:(("avahi",pid=70,fd=4))\n'
        'u_str LISTEN 0      4096 @/tmp/.X11-unix/X101 31 * 0 users:(("Xvfb",pid=40,fd=5))\n'
        'u_str LISTEN 0      5    /run/jht-broker/broker.sock 33 * 0 users:(("python3",pid=7,fd=4),("python3",pid=9,fd=4))\n'
    )
    assert [r["pids"] for r in rows] == [[58], [60], [70], [40], [7, 9]]
    assert [gate.listener_kind(r) for r in rows] == ["inet", "inet", "inet", "abstract", None]
    assert rows[0]["local"].rsplit(":", 1)[1] == "6081"


def test_volume_mounts_match_the_data_directory_not_the_path():
    assert gate.volume_mounts(BROKER_MOUNTINFO, VOLUMES) == [
        "jhtisolation_jht-broker-sock on /run/jht-broker",
        "jhtisolation_jht-broker-state on /jht_broker_state",
        "jhtisolation_jht-secrets on /jht_secrets",
    ]
    # The same volume mounted elsewhere is still the broker's.
    moved = ["1 2 8:1 /volumes/jhtisolation_jht-secrets/_data /profile rw - ext4 /dev/sdb rw"]
    assert gate.volume_mounts(moved, VOLUMES) == ["jhtisolation_jht-secrets on /profile"]
    # Rootless Podman keeps volumes under the user's storage.
    rootless = ["1 2 0:5 /home/runner/.local/share/containers/storage/volumes/jhtisolation_jht-secrets/_data "
                "/jht_secrets rw - ext4 /dev/root rw"]
    assert gate.volume_mounts(rootless, VOLUMES) == ["jhtisolation_jht-secrets on /jht_secrets"]
    assert gate.volume_mounts(TWIN_MOUNTINFO, VOLUMES) == []


def test_rfb_reads_the_first_websocket_frame():
    assert gate.rfb(RFB)
    assert not gate.rfb(DEAD)
    assert not gate.rfb({"error": "ConnectionRefusedError"})
    assert not gate.rfb({"status": "HTTP/1.1 404 Not Found", "body_b64": ""})
    long_frame = base64.b64encode(bytes([0x82, 126, 0, 200]) + b"RFB 003.008\n").decode()
    assert gate.rfb({"body_b64": long_frame})


def test_the_container_probes_compile():
    compile(gate.ATTACK, "attack", "exec")
    compile(gate.BROKER_SIDE, "broker_side", "exec")


def test_the_gate_starts_every_service_but_the_agents_side():
    started = gate.services([str(ROOT / "docker-compose.yml")])
    assert "jht-broker" in started
    assert not set(started) & set(gate.AGENT_SIDE)


def test_the_workflow_runs_the_gate_under_docker_and_rootless_podman():
    workflow = yaml.load((ROOT / ".github" / "workflows" / "browser-isolation.yml").read_text(), Loader=yaml.BaseLoader)
    runs = {name: " ".join(step.get("run", "") for step in job["steps"]) for name, job in workflow["jobs"].items()}
    assert "browser_isolation.py docker" in runs["browser-isolation-docker"]
    assert "compose-apparmor.yml" in runs["browser-isolation-docker"]
    assert "browser_isolation.py podman" in runs["browser-isolation-podman"]
    # Rootless Podman refuses apparmor=: only the seccomp override, as jht up.
    assert "compose-apparmor.yml" not in runs["browser-isolation-podman"]
    assert "podman-compose==1.6.0" in runs["browser-isolation-podman"]
    for path in ("scripts/ci/browser_isolation.py", "docker-compose.yml", "shared/broker/**"):
        assert path in workflow["on"]["push"]["paths"]
    # Red by design until S: only the trial branches and dispatch, never a
    # fixed red on master or master-arthur.
    assert workflow["on"]["push"]["branches"] == ["ci-**"]
    assert "workflow_dispatch" in workflow["on"]


def test_the_declared_vnc_is_websockify_s_live_peer():
    rows = gate.parse_ss(
        'tcp   ESTAB 0 0 127.0.0.1:6081 127.0.0.1:50000 users:(("python3",pid=58,fd=9))\n'
        'tcp   ESTAB 0 0 127.0.0.1:50122 127.0.0.1:41234 users:(("python3",pid=58,fd=10))\n'
        'tcp   ESTAB 0 0 127.0.0.1:41234 127.0.0.1:50122 users:(("x11vnc",pid=60,fd=8))\n'
        'u_str ESTAB 0 0 * 31 * 32 users:(("python3",pid=58,fd=4))\n'
    )
    assert gate.declared_vnc(rows, lambda pid: pid == 58, 6081) == "127.0.0.1:41234"
    assert gate.declared_vnc(rows, lambda pid: False, 6081) is None


def test_addresses_and_profile_files():
    assert gate.split_address("[::1]:5900") == ("::1", 5900)
    assert gate.split_address("127.0.0.1:5901") == ("127.0.0.1", 5901)
    assert gate.split_address("*:5900") == ("*", 5900)
    for name in ("Default/Login Data", "Default/Login Data-journal", "Default/Login Data For Account-wal",
                 "Default/Web Data", "Default/Account Web Data", "Default/Account Web Data-wal"):
        assert gate.excluded_profile_file(name), name
    for name in ("Default/Cookies", "Local State", "Default/Preferences", "Default/jht-gate-marker"):
        assert not gate.excluded_profile_file(name), name


def test_the_seed_and_the_listing_compile_and_seed_what_the_copy_must_drop():
    compile(gate.SEED, "seed", "exec")
    compile(gate.LIST_PROFILE, "list", "exec")
    for name in ("Login Data", "Login Data For Account", "Web Data", "Account Web Data",
                 "Login Data-journal", "Login Data For Account-wal", "Web Data-journal", "Account Web Data-wal"):
        assert f'"{name}"' in gate.SEED, name
