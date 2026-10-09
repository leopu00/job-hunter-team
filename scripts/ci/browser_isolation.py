#!/usr/bin/env python3
"""The login browser kept away from the broker's secrets (P2-3), seen from a
compromised Chromium: the CI gate of design S (the `jht-browser` twin
container, uid 1004, its own `jht-browser-profile` volume; `jht-secrets`,
`jht-broker-state` and `jht-broker-sock` stay with the broker).

The stack comes up as the product starts it: the repository's compose file
plus the broker's overrides that install.sh puts in /etc/jht/security, every
service but the agents' side. A login view is opened as the desktop opens it
(`jht-broker-admin view start linkedin-login`), so Chromium really runs.

Then both processes are found by ROLE, never by container name:
- the broker: the Python process running `jht-broker serve`;
- Chromium: the browser process (program `chrome`, no `--type=`) inside a
  container of this project.
Their containers are the ones whose main process is an ancestor of each.

The attacker is a process with Chromium's uid (and gid) in Chromium's
container (`exec --user`): same namespaces, same seccomp and AppArmor
profile, same no-new-privileges. It FAILS unless:

1. [secrets] [broker-state] it reads nothing from `jht-secrets` and
   `jht-broker-state`, at the broker's paths and through /proc/<pid>/root of
   every broker process it can see. A canary written by the broker into both
   comes first, so "nothing read" is not an empty search.
   [chromium-uid] Chromium's host uid is not the broker's.
2. [ptrace] [proc] PTRACE_SEIZE, /proc/<pid>/mem, environ, maps, fd and root
   of every broker process it sees are refused. [pid-namespace] When it sees
   none, Chromium's pid namespace must differ from the broker's (the host
   reads both): otherwise "none seen" would prove nothing.
3. [signal] kill(pid, 0) and SIGWINCH to every broker process are refused.
4. [agent-socket] the agents' socket, at the broker's path and through
   /proc/<pid>/root, answers it nothing but `peer_not_allowed`.
5. [loopback] in the network namespace Chromium sees, the broker's
   processes listen (TCP, UDP, abstract unix) only with websockify: `ss
   -ltuxnp` from the host, each socket attributed to its container.
   [websockify] websockify gives it no VNC (no `RFB ` frame) without the token
   or with a wrong one; the host's own connection with the issued token
   must get `RFB ` [websockify-control].
6. [mounts] /proc/self/mountinfo has none of the three broker volumes; the
   same matcher run in the broker must find all three [mount-control].
7. [broker-userns] from the broker (its uid, its container) `unshare
   (CLONE_NEWUSER)` fails: the broker is back on the engine's profiles.
   [userns-control] the attacker's own unshare must work: Chromium's
   container keeps the jht-broker profile, which its sandbox needs.
8. Podman only: [uid-map] the uid maps of the broker and of Chromium differ,
   and the broker's host uid is printed with whether Chromium's namespace
   maps it.
9. VNC: every TCP listener of the shared network namespace is probed for an
   RFB greeting. The declared VNC is the one websockify really connects to
   while the host's token connection is open (ss on the websockify
   process). [vnc-address] no VNC on anything but 127.0.0.1 (::1 included);
   [vnc-port] no VNC on another port; [vnc-nopw] no VNC that offers the
   security type None. [vnc-control] at least one VNC found, and the
   declared one known.
10. The LinkedIn profile: before the stack starts, a profile is seeded in
   jht-secrets as an existing user has it: Cookies (with a row unique to
   this run) and Cookies-journal, Login Data, Login Data For Account, Web
   Data, Account Web Data with their -journal and -wal, and a file that
   must stay behind. The copy is an allow-list (design S: Default/Cookies
   and Default/Cookies-journal into linkedin/ of the twin's volume) and
   starts at the broker's first `view status`; the volume is read after it
   and before `view start`, so Chromium has not touched the copy yet.
   [browser-profile] a jht-browser-profile volume exists (on today's design
   it does not: not applicable, red); [profile-copy] it holds no *Login
   Data* or *Web Data* file and no other file of the old profile;
   [profile-copy-control] Cookies and Cookies-journal arrived byte for byte;
   [profile-left] the profile is gone from jht-secrets.

On today's design (Chromium uid 1002 in the broker's container) the gate is
RED by design; the expected checks are declared in EXPECTED_RED_TODAY and
the last line says whether the red matches them.

Usage: browser_isolation.py ENGINE IMAGE COMPOSE_FILE [OVERRIDE ...]
ENGINE is docker (rootful) or podman (rootless; podman-compose runs the
stack). Run from a non-root user with passwordless sudo: the host-side reads
(namespaces, ss -p) need root. Prints one MEASURE line per fact and one FAIL
line per broken check; exit 0 only when every check passes.
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path

PROJECT = "jhtisolation"
# The agents' side of the compose: the gate starts every other service, so
# the twin is included whatever it is called.
AGENT_SIDE = ("jht", "jht-telegram")
BROKER_VOLUMES = ("jht-secrets", "jht-broker-state", "jht-broker-sock")
SECRET_VOLUMES = {"jht-secrets": "secrets", "jht-broker-state": "broker-state"}
CANARY = ".isolation-canary"
PROFILE_VOLUME = "jht-browser-profile"
LEGACY_PROFILE = "linkedin-profile"
# Design S: where the twin keeps the copy, and the only files it copies.
COPY_DIR = "linkedin"
COPIED = ("Default/Cookies", "Default/Cookies-journal")
CHROMIUM_PROGRAMS = ("chrome", "chromium", "chromium-browser")

# Today's design (Chromium is uid 1002 in the broker's container). Kept by
# the gate, not by the job: when S lands these must all turn green.
# Not expected red today:
# - ptrace: Yama (ptrace_scope 1 on the runner) refuses a non-descendant,
#   even with the same uid; the jht-broker profile alone would allow it;
# - agent-socket: the broker refuses every peer uid but 1001 already;
# - websockify: a wrong token already gets a dead target.
# Red today in 9 and 10: x11vnc runs with -nopw and listens on ::1 too (5900
# and 5901); no jht-browser-profile volume, the profile stays in jht-secrets.
EXPECTED_RED_TODAY = {
    "docker": {"secrets", "broker-state", "chromium-uid", "proc", "signal", "loopback", "mounts",
               "broker-userns", "vnc-address", "vnc-port", "vnc-nopw", "browser-profile", "profile-left"},
    "podman": {"secrets", "broker-state", "chromium-uid", "proc", "signal", "loopback", "mounts",
               "broker-userns", "uid-map", "vnc-address", "vnc-port", "vnc-nopw", "browser-profile",
               "profile-left"},
}

# Runs in Chromium's container with Chromium's uid. argv[1]: the context.
ATTACK = r'''
import base64, ctypes, json, os, signal, socket, sys, time
ctx = json.loads(sys.argv[1])
libc = ctypes.CDLL(None, use_errno=True)
out = {"uid": os.getuid(), "gid": os.getgid()}

def argv(pid):
    try:
        return [a.decode(errors="replace") for a in open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0") if a]
    except OSError:
        return []

def broker_process(cmd):
    if not cmd:
        return False
    program = os.path.basename(cmd[0].split(" ", 1)[0])
    if not (program.startswith("python") or program == "jht-broker"):
        return False
    return any(os.path.basename(a) == "jht-broker" or a.startswith("broker.") for a in cmd)

me = os.getpid()
targets = [int(p) for p in os.listdir("/proc") if p.isdigit() and int(p) != me and broker_process(argv(p))]
out["broker_pids_visible"] = targets
out["own_pidns"] = os.readlink("/proc/self/ns/pid")

def first_byte(path):
    try:
        with open(path, "rb") as handle:
            handle.read(1)
        return True
    except OSError:
        return False

def opens(path):
    try:
        os.close(os.open(path, os.O_RDONLY))
        return True
    except OSError:
        return False

roots = [""] + [f"/proc/{pid}/root" for pid in targets]
reads = {}
for kind, dests in ctx["secret_dirs"].items():
    got = []
    for root in roots:
        for dest in dests:
            base = root + dest
            if first_byte(f"{base}/{ctx['canary']}"):
                got.append(f"{base}/{ctx['canary']}")
            for top, _dirs, files in os.walk(base):
                for name in files:
                    if first_byte(os.path.join(top, name)):
                        got.append(os.path.join(top, name))
                if len(got) > 40:
                    break
    reads[kind] = sorted(set(got))[:20]
out["reads"] = reads

PTRACE_SEIZE, PTRACE_DETACH = 0x4206, 17
libc.ptrace.argtypes = [ctypes.c_long, ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p]
seized, proc_reads, signalled = [], [], []
for pid in targets:
    if libc.ptrace(PTRACE_SEIZE, pid, None, None) == 0:
        seized.append(pid)
        libc.ptrace(PTRACE_DETACH, pid, None, None)
    # mem: the ptrace check is made at open (a read at offset 0 fails
    # anyway, nothing is mapped there); environ and maps: at read.
    if opens(f"/proc/{pid}/mem"):
        proc_reads.append(f"{pid}/mem")
    for name in ("environ", "maps"):
        if first_byte(f"/proc/{pid}/{name}"):
            proc_reads.append(f"{pid}/{name}")
    for name in ("fd", "root"):
        try:
            os.listdir(f"/proc/{pid}/{name}")
            proc_reads.append(f"{pid}/{name}")
        except OSError:
            pass
    for sig in (0, signal.SIGWINCH):
        try:
            os.kill(pid, sig)
            signalled.append(f"{pid}/{int(sig)}")
        except OSError:
            pass
out["ptrace"] = seized
out["proc_reads"] = sorted(set(proc_reads))
out["signals"] = signalled

# The control: ptrace of its own child. If even that is refused, the
# refusals above say only that ptrace is off here.
child = os.fork()
if child == 0:
    time.sleep(3)
    os._exit(0)
out["ptrace_own_child"] = libc.ptrace(PTRACE_SEIZE, child, None, None) == 0
os.kill(child, signal.SIGKILL)
os.waitpid(child, 0)

answers = []
for root in roots:
    for dest in ctx["sock_dirs"]:
        path = f"{root}{dest}/broker.sock"
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                conn.settimeout(10)
                conn.connect(path)
                conn.sendall(b'{"op": "mail.status", "args": {}, "role": "scout"}\n')
                data = b""
                while b"\n" not in data:
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
            answers.append({"path": path, "answer": data.decode(errors="replace").strip()[:200]})
        except OSError as exc:
            answers.append({"path": path, "error": type(exc).__name__})
out["agent_socket"] = answers

def websocket(port, query):
    key = base64.b64encode(os.urandom(16)).decode()
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
            conn.sendall((f"GET /websockify{query} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n"
                          f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                          "Sec-WebSocket-Protocol: binary\r\n\r\n").encode())
            data, deadline = b"", time.time() + 5
            while time.time() < deadline:
                try:
                    chunk = conn.recv(4096)
                except socket.timeout:
                    break
                if not chunk:
                    break
                data += chunk
    except OSError as exc:
        return {"error": type(exc).__name__}
    head, _, body = data.partition(b"\r\n\r\n")
    return {"status": head.split(b"\r\n", 1)[0].decode(errors="replace"), "body_b64": base64.b64encode(body[:64]).decode()}

if ctx.get("ws_port"):
    out["websockify_no_token"] = websocket(ctx["ws_port"], "")
    out["websockify_wrong_token"] = websocket(ctx["ws_port"], "?token=" + base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("="))

def recv_exact(conn, size):
    data = b""
    while len(data) < size:
        chunk = conn.recv(size - len(data))
        if not chunk:
            break
        data += chunk
    return data

def rfb_probe(local):
    host, _, port = local.rpartition(":")
    host = host.strip("[]")
    host = {"*": "127.0.0.1", "0.0.0.0": "127.0.0.1", "::": "::1"}.get(host, host)
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    try:
        with socket.socket(family, socket.SOCK_STREAM) as conn:
            conn.settimeout(3)
            conn.connect((host, int(port)))
            hello = recv_exact(conn, 12)
            if not hello.startswith(b"RFB "):
                return {"local": local, "rfb": False}
            conn.sendall(hello)
            if hello[4:11] == b"003.003":
                types = [int.from_bytes(recv_exact(conn, 4), "big")]
            else:
                count = recv_exact(conn, 1)
                types = list(recv_exact(conn, count[0])) if count else None
            return {"local": local, "rfb": True, "version": hello.decode(errors="replace").strip(), "types": types}
    except (OSError, ValueError) as exc:
        return {"local": local, "error": type(exc).__name__}

out["vnc"] = [rfb_probe(local) for local in ctx.get("tcp_listeners") or []]

try:
    out["mountinfo"] = open("/proc/self/mountinfo").read().splitlines()
except OSError as exc:
    out["mountinfo"] = []
    out["mountinfo_error"] = type(exc).__name__

pid = os.fork()
if pid == 0:
    os._exit(0 if libc.unshare(0x10000000) == 0 else 1)
out["unshare_user"] = os.WEXITSTATUS(os.waitpid(pid, 0)[1]) == 0
for name in ("attr/apparmor/current", "attr/current"):
    try:
        out["label"] = open(f"/proc/self/{name}").read().strip("\x00\n ")
        break
    except OSError:
        continue
print(json.dumps(out))
'''

# Runs in the broker's container with the broker's uid.
BROKER_SIDE = r'''
import ctypes, json, os, sys
ctx = json.loads(sys.argv[1])
libc = ctypes.CDLL(None, use_errno=True)
out = {"uid": os.getuid()}
placed = {}
for kind, dests in ctx["secret_dirs"].items():
    for dest in dests:
        path = f"{dest}/{ctx['canary']}"
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            os.write(fd, b"canary")
            os.close(fd)
            placed[path] = open(path, "rb").read() == b"canary"
        except OSError as exc:
            placed[path] = type(exc).__name__
out["canaries"] = placed
out["sockets"] = {d: os.path.exists(f"{d}/broker.sock") for d in ctx["sock_dirs"]}
out["legacy_profile"] = any(os.path.lexists(f"{d}/{ctx['legacy_profile']}") for d in ctx["secret_dirs"]["jht-secrets"])
pid = os.fork()
if pid == 0:
    os._exit(0 if libc.unshare(0x10000000) == 0 else 1)
out["unshare_user"] = os.WEXITSTATUS(os.waitpid(pid, 0)[1]) == 0
out["mountinfo"] = open("/proc/self/mountinfo").read().splitlines()
print(json.dumps(out))
'''


# Runs as root in a throwaway container with jht-secrets on /jht_secrets,
# before the stack starts: the profile an existing user has (the broker's
# Chromium wrote it), with the files the copy must leave behind.
SEED = r'''
import hashlib, json, os, sqlite3, sys
ctx = json.loads(sys.argv[1])
root = "/jht_secrets"
profile = os.path.join(root, ctx["legacy_profile"])
default = os.path.join(profile, "Default")
os.makedirs(default, exist_ok=True)
for name in ("Login Data", "Login Data For Account", "Web Data", "Account Web Data", "Cookies"):
    db = sqlite3.connect(os.path.join(default, name))
    db.execute("CREATE TABLE IF NOT EXISTS jht_gate (x TEXT)")
    if name == "Cookies":
        db.execute("INSERT INTO jht_gate VALUES (?)", (ctx["run"],))  # this run's own bytes
    db.commit()
    db.close()
with open(os.path.join(default, "Cookies-journal"), "w") as handle:
    handle.write("jht gate " + ctx["run"] + "\n")
for name in ("Login Data-journal", "Login Data For Account-wal", "Web Data-journal", "Account Web Data-wal"):
    open(os.path.join(default, name), "wb").close()
with open(os.path.join(default, "jht-gate-left-behind"), "w") as handle:
    handle.write("must not be copied\n")
if os.stat(root).st_uid == 0:
    os.chown(root, 1002, 1002)
    os.chmod(root, 0o700)
seeded = {}
for top, dirs, files in os.walk(profile):
    for name in [top] + [os.path.join(top, n) for n in dirs + files]:
        os.chown(name, 1002, 1002)
    for name in files:
        path = os.path.join(top, name)
        seeded[os.path.relpath(path, profile)] = hashlib.sha256(open(path, "rb").read()).hexdigest()
os.chmod(profile, 0o700)
print(json.dumps({"seeded": seeded}))
'''

# Runs as root in a throwaway container with the browser's profile volume
# read-only on /p: every file, with its sha256 (links are listed, never
# followed).
LIST_PROFILE = r'''
import hashlib, json, os
files = {}
for top, dirs, names in os.walk("/p"):
    for name in names + dirs:
        path = os.path.join(top, name)
        rel = os.path.relpath(path, "/p")
        if os.path.islink(path):
            files[rel] = "symlink"
        elif os.path.isfile(path):
            files[rel] = hashlib.sha256(open(path, "rb").read()).hexdigest()
print(json.dumps({"files": dict(sorted(files.items())[:2000])}))
'''


# ── pure helpers (tests/test_browser_isolation_ci.py) ────────────────────


def program(cmd: list[str]) -> str:
    """The first word of argv[0]: the zygote's children rewrite their title
    into argv[0] as one string with spaces."""
    return os.path.basename(cmd[0].split(" ", 1)[0]) if cmd and cmd[0] else ""


def chromium_browser(cmd: list[str]) -> bool:
    # The words, not the arguments: a rewritten title holds `--type=` inside argv[0].
    return program(cmd) in CHROMIUM_PROGRAMS and not any(w.startswith("--type=") for a in cmd for w in a.split())


def broker_serve(cmd: list[str]) -> bool:
    name = program(cmd)
    if not (name.startswith("python") or name == "jht-broker"):
        return False
    return any(os.path.basename(a) == "jht-broker" for a in cmd) and "serve" in cmd


def websockify(cmd: list[str]) -> bool:
    return program(cmd).startswith("python") and "broker.view_ws" in cmd


def inside_id(host_id: int, id_map: list[tuple[int, int, int]]) -> int | None:
    """A host uid seen from inside a user namespace (uid_map rows: inside,
    outside, count), or None when that namespace does not map it."""
    for inside, outside, count in id_map:
        if outside <= host_id < outside + count:
            return inside + host_id - outside
    return None


def parse_id_map(text: str) -> list[tuple[int, int, int]]:
    return [tuple(int(x) for x in line.split()) for line in text.splitlines() if line.strip()]  # type: ignore[misc]


def parse_ss(text: str) -> list[dict]:
    """`ss -H -l -t -u -x -n -p` lines: netid, local address, owner pids."""
    rows = []
    for line in text.splitlines():
        fields = line.split()
        if len(fields) < 5:
            continue
        rows.append({"netid": fields[0], "state": fields[1], "local": fields[4],
                     "peer": fields[5] if len(fields) > 5 else "",
                     "pids": sorted({int(p) for p in re.findall(r"pid=(\d+)", line)}),
                     "line": line.strip()})
    return rows


def listener_kind(row: dict) -> str | None:
    """What a listening socket exposes on the shared network namespace:
    "inet" (TCP/UDP), "abstract" (a unix name with no file), or None for a
    unix socket with a path (reached through a file, see checks 4 and 6)."""
    if row["netid"] in ("tcp", "udp"):
        return "inet"
    if row["netid"].startswith("u_"):
        return "abstract" if row["local"].startswith("@") else None
    return None


def volume_mounts(mountinfo: list[str], volumes: list[dict]) -> list[str]:
    """The mountinfo lines that mount one of the broker's volumes: the root of
    the mount (4th field) is the volume's data directory, whatever path it
    is mounted on."""
    hits = []
    for line in mountinfo:
        fields = line.split()
        if len(fields) < 5:
            continue
        root = fields[3]
        for volume in volumes:
            source = volume.get("source") or ""
            if (source and root == source) or root.endswith(f"/{volume['name']}/_data"):
                hits.append(f"{volume['name']} on {fields[4]}")
    return sorted(set(hits))


def split_address(local: str) -> tuple[str, int]:
    """`127.0.0.1:5901`, `[::1]:5900`, `*:5900` -> (host, port)."""
    host, _, port = local.rpartition(":")
    return host.strip("[]"), int(port)


def excluded_profile_file(path: str) -> bool:
    """What the copy of the profile must leave behind: the password manager
    and autofill databases, with their -journal and -wal."""
    name = os.path.basename(path)
    return "Login Data" in name or "Web Data" in name


def declared_vnc(rows: list[dict], is_websockify, ws_port: int) -> str | None:
    """The VNC websockify really talks to: the peer of its established TCP
    connection that is not its own listening port."""
    for row in rows:
        if row["netid"] != "tcp" or row["state"] != "ESTAB" or not any(is_websockify(p) for p in row["pids"]):
            continue
        if split_address(row["local"])[1] != ws_port:
            return row["peer"]
    return None


def rfb(answer: dict | None) -> bool:
    """A VNC server spoke: the first WebSocket frame carries `RFB 003.00x`."""
    if not answer or "body_b64" not in answer:
        return False
    body = base64.b64decode(answer["body_b64"])
    if len(body) < 2:
        return False
    length, offset = body[1] & 0x7F, 2
    if length == 126:
        offset = 4
    elif length == 127:
        offset = 10
    return body[offset:offset + 4] == b"RFB "


def verdict(facts: dict, engine: str) -> list[tuple[str, str]]:
    """Every broken check, as (tag, message). Pure: the facts come from collect()."""
    fails: list[tuple[str, str]] = []

    def fail(tag: str, message: str) -> None:
        fails.append((tag, message))

    if facts.get("error"):
        return [("setup", facts["error"])]
    attack = facts.get("attack") or {}
    broker = facts.get("broker_side") or {}
    if "error" in attack or not attack:
        return [("attack", f"the attacker's probe gave no answer: {attack.get('error')}")]
    if "error" in broker or not broker:
        return [("broker-side", f"the broker's probe gave no answer: {broker.get('error')}")]

    if attack.get("uid") != facts["chromium"]["uid"]:
        fail("attacker", f"the probe ran as uid {attack.get('uid')}, Chromium is {facts['chromium']['uid']}")

    # 1. secrets
    canaries = broker.get("canaries") or {}
    if not canaries or not all(v is True for v in canaries.values()):
        fail("canary", f"the broker could not place its canaries: {canaries}")
    for volume, tag in SECRET_VOLUMES.items():
        got = (attack.get("reads") or {}).get(volume)
        if got:
            fail(tag, f"Chromium's uid reads {volume}: {got[:5]}")
    if facts["chromium"]["host_uid"] == facts["broker"]["host_uid"]:
        fail("chromium-uid", f"Chromium runs as the broker's host uid {facts['broker']['host_uid']}")

    # 2. and 3. ptrace, /proc, signals
    if not attack.get("broker_pids_visible"):
        if facts["chromium"]["pidns"] == facts["broker"]["pidns"]:
            fail("pid-namespace", "no broker process seen, yet Chromium shares the broker's pid namespace")
    if attack.get("ptrace"):
        fail("ptrace", f"PTRACE_SEIZE of broker processes {attack['ptrace']}")
    if attack.get("proc_reads"):
        fail("proc", f"/proc of broker processes: {attack['proc_reads'][:8]}")
    if attack.get("signals"):
        fail("signal", f"signals delivered to broker processes: {attack['signals'][:8]}")

    # 4. the agents' socket
    if not any(broker.get("sockets", {}).values()):
        fail("socket-control", f"the broker has no socket at its own path: {broker.get('sockets')}")
    for answer in attack.get("agent_socket") or []:
        if "answer" in answer and '"peer_not_allowed"' not in answer["answer"]:
            fail("agent-socket", f"{answer['path']} answered {answer['answer']}")

    # 5. the loopback
    if not facts.get("websockify_listening"):
        fail("loopback-control", "ss saw no websockify listener: the attribution proves nothing")
    for row in facts.get("broker_listeners") or []:
        fail("loopback", f"the broker exposes {row}")
    for row in facts.get("unattributed_listeners") or []:
        fail("loopback", f"a listener with no process: {row}")
    for case in ("websockify_no_token", "websockify_wrong_token"):
        if rfb(attack.get(case)):
            fail("websockify", f"VNC reached with {case.split('_', 1)[1].replace('_', ' ')}")
    if not rfb(facts.get("websockify_control")):
        fail("websockify-control", f"the issued token got no VNC: {facts.get('websockify_control')}")

    # 6. mounts
    volumes = facts["broker"]["volumes"]
    if len(volume_mounts(broker.get("mountinfo") or [], volumes)) < len(BROKER_VOLUMES):
        fail("mount-control", f"the matcher does not find the broker's own volumes: {volumes}")
    mounted = volume_mounts(attack.get("mountinfo") or [], volumes)
    if mounted:
        fail("mounts", f"broker volumes in Chromium's container: {mounted}")

    # 7. user namespaces
    if broker.get("unshare_user") is not False:
        fail("broker-userns", "the broker's Python created a user namespace")
    if attack.get("unshare_user") is not True:
        fail("userns-control", "Chromium's uid cannot create a user namespace: its sandbox would not start")

    # 9. VNC
    declared = facts.get("declared_vnc")
    found = [v for v in attack.get("vnc") or [] if v.get("rfb")]
    if not found or not declared:
        fail("vnc-control", f"VNC listeners found {found}, declared {declared}: the scan proves nothing")
    else:
        want_host, want_port = split_address(declared)
        for vnc in found:
            host, port = split_address(vnc["local"])
            if host != "127.0.0.1":
                fail("vnc-address", f"VNC on {vnc['local']}: only 127.0.0.1 may carry it")
            if port != want_port:
                fail("vnc-port", f"VNC on {vnc['local']}, the declared one is {declared}")
            if vnc.get("types") is None or 1 in vnc["types"]:
                fail("vnc-nopw", f"VNC on {vnc['local']} offers no password (security types {vnc.get('types')})")

    # 10. The profile
    profile = facts.get("browser_profile") or {}
    if not profile.get("volume"):
        fail("browser-profile", f"no {PROFILE_VOLUME} volume in the project (today's design: not applicable)")
    else:
        files = profile.get("files") or {}
        seeded = facts.get("seeded") or {}
        old = [f"{COPY_DIR}/{path}" for path in seeded if path not in COPIED]
        wrong = sorted({f for f in files if excluded_profile_file(f)} | {f for f in old if f in files})
        if wrong:
            fail("profile-copy", f"{PROFILE_VOLUME} holds {wrong[:8]}")
        for path in COPIED:
            if path not in seeded or files.get(f"{COPY_DIR}/{path}") != seeded[path]:
                fail("profile-copy-control", f"{path} did not arrive byte for byte in {PROFILE_VOLUME}/{COPY_DIR}")
    if broker.get("legacy_profile") is not False:
        fail("profile-left", f"the profile is still in jht-secrets ({LEGACY_PROFILE})")

    # 8. Podman: the uid maps
    if engine == "podman":
        if facts["chromium"]["uid_map"] == facts["broker"]["uid_map"]:
            fail("uid-map", f"broker and Chromium share the uid map {facts['broker']['uid_map']}")
    return fails


# ── host side ────────────────────────────────────────────────────────────


def sh(cmd: list[str], timeout: int = 120, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)


def sudo_read(path: str) -> str:
    return sh(["sudo", "cat", path]).stdout


def sudo_link(path: str) -> str:
    return sh(["sudo", "readlink", path]).stdout.strip()


def host_argv(pid: int) -> list[str]:
    try:
        return [a.decode(errors="replace") for a in Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0") if a]
    except OSError:
        return []


def host_status(pid: int) -> dict:
    # status is world-readable: the parent walk reads it without sudo.
    try:
        text = Path(f"/proc/{pid}/status").read_text()
    except OSError:
        text = ""
    fields = {}
    for line in text.splitlines():
        name, _, value = line.partition(":")
        fields[name] = value.strip()
    return fields


def host_pids() -> list[int]:
    return [int(p) for p in os.listdir("/proc") if p.isdigit()]


def compose_cmd(engine: str, files: list[str]) -> list[str]:
    flags = [x for f in files for x in ("-f", f)]
    if engine == "podman":
        return ["podman-compose", "-p", PROJECT, *flags]
    return ["docker", "compose", "-p", PROJECT, *flags]


def services(files: list[str]) -> list[str]:
    import yaml

    names: list[str] = []
    for path in files:
        for name in (yaml.safe_load(Path(path).read_text()) or {}).get("services") or {}:
            if name not in names:
                names.append(name)
    return [n for n in names if n not in AGENT_SIDE]


def project_containers(engine: str) -> dict[int, str]:
    """Main pid -> container id, for this project's containers."""
    out = {}
    for label in ("com.docker.compose.project", "io.podman.compose.project"):
        ids = sh([engine, "ps", "-q", "--no-trunc", "--filter", f"label={label}={PROJECT}"]).stdout.split()
        for cid in ids:
            pid = sh([engine, "inspect", "-f", "{{.State.Pid}}", cid]).stdout.strip()
            if pid.isdigit() and int(pid) > 0:
                out[int(pid)] = cid
    return out


def container_of(pid: int, mains: dict[int, str]) -> str | None:
    seen = set()
    while pid > 1 and pid not in seen:
        if pid in mains:
            return mains[pid]
        seen.add(pid)
        ppid = host_status(pid).get("PPid", "0")
        pid = int(ppid) if ppid.isdigit() else 0
    return None


def process(pid: int, cid: str) -> dict:
    status = host_status(pid)
    id_map = parse_id_map(sudo_read(f"/proc/{pid}/uid_map"))
    gid_map = parse_id_map(sudo_read(f"/proc/{pid}/gid_map"))
    host_uid, host_gid = int(status["Uid"].split()[0]), int(status["Gid"].split()[0])
    return {"pid": pid, "container": cid, "host_uid": host_uid, "uid": inside_id(host_uid, id_map),
            "gid": inside_id(host_gid, gid_map), "uid_map": id_map,
            "pidns": sudo_link(f"/proc/{pid}/ns/pid"), "netns": sudo_link(f"/proc/{pid}/ns/net")}


def exec_json(engine: str, cid: str, user: str, code: str, ctx: dict) -> dict:
    result = sh([engine, "exec", "--user", user, cid, "python3", "-c", code, json.dumps(ctx)], timeout=180)
    lines = result.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"error": f"exit {result.returncode}: {result.stderr[-600:]}"}
    except json.JSONDecodeError:
        return {"error": (result.stderr or result.stdout)[-600:]}


def broker_volumes(engine: str, cid: str) -> list[dict]:
    mounts = json.loads(sh([engine, "inspect", "-f", "{{json .Mounts}}", cid]).stdout or "[]")
    found = []
    for mount in mounts:
        name = mount.get("Name") or ""
        for volume in BROKER_VOLUMES:
            if name == volume or name.endswith(f"_{volume}"):
                found.append({"volume": volume, "name": name, "source": mount.get("Source"),
                              "destination": mount.get("Destination")})
    return found


def websocket_with_token(port: int, token: str, while_open=None) -> tuple[dict, str]:
    key = base64.b64encode(secrets.token_bytes(16)).decode()
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=5) as conn:
            conn.sendall((f"GET /websockify?token={token} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                          f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n\r\n").encode())
            data, deadline = b"", time.time() + 8
            while time.time() < deadline and b"RFB " not in data:
                try:
                    chunk = conn.recv(4096)
                except socket.timeout:
                    break
                if not chunk:
                    break
                data += chunk
            seen = while_open() if while_open else ""
    except OSError as exc:
        return {"error": type(exc).__name__}, ""
    head, _, body = data.partition(b"\r\n\r\n")
    return {"status": head.split(b"\r\n", 1)[0].decode(errors="replace"),
            "body_b64": base64.b64encode(body[:64]).decode()}, seen


def wait_for(what, timeout: float, step: float = 1.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = what()
        if found:
            return found
        time.sleep(step)
    return what()


def read_profile(engine: str, image: str) -> dict:
    names = sh([engine, "volume", "ls", "-q"]).stdout.split()
    volume = next((n for n in names if n == f"{PROJECT}_{PROFILE_VOLUME}"), None)
    if not volume:
        return {"volume": None}
    listed = sh([engine, "run", "--rm", "--user", "0", "--network", "none", "-v", f"{volume}:/p:ro",
                 "--entrypoint", "python3", image, "-c", LIST_PROFILE])
    try:
        return {"volume": volume, **json.loads(listed.stdout.strip().splitlines()[-1])}
    except (IndexError, json.JSONDecodeError):
        return {"volume": volume, "files": {}, "error": listed.stderr[-400:]}


def collect(engine: str, image: str, files: list[str]) -> dict:
    env = {**os.environ, "JHT_IMAGE": image}
    # 10: the existing user's profile, in place before anything starts.
    created = sh([*compose_cmd(engine, files), "up", "--no-start", *services(files)], timeout=600, env=env)
    if created.returncode != 0:
        return {"error": f"compose up --no-start failed: {(created.stderr or created.stdout)[-800:]}"}
    seeded = sh([engine, "run", "--rm", "--user", "0", "--network", "none", "-v", f"{PROJECT}_jht-secrets:/jht_secrets",
                 "--entrypoint", "python3", image, "-c", SEED,
                 json.dumps({"legacy_profile": LEGACY_PROFILE, "run": secrets.token_hex(16)})])
    print(f"MEASURE seed exit={seeded.returncode} {seeded.stdout.strip()[-900:]}")
    try:
        seed = json.loads(seeded.stdout.strip().splitlines()[-1])["seeded"]
    except (IndexError, KeyError, json.JSONDecodeError):
        return {"error": f"the profile could not be seeded: {seeded.stderr[-600:]}"}
    up = sh([*compose_cmd(engine, files), "up", "-d", *services(files)], timeout=600, env=env)
    print(f"MEASURE compose-up exit={up.returncode} services={services(files)}")
    if up.returncode != 0:
        return {"error": f"compose up failed: {(up.stderr or up.stdout)[-800:]}"}

    def brokers() -> list[int]:
        return [p for p in host_pids() if broker_serve(host_argv(p))]

    mains = project_containers(engine)
    found = wait_for(lambda: [p for p in brokers() if container_of(p, mains)], 90)
    if len(found) != 1:
        return {"error": f"{len(found)} broker processes (jht-broker serve) in the project: {found}"}
    broker_cid = container_of(found[0], mains)
    broker = process(found[0], broker_cid)
    broker["volumes"] = broker_volumes(engine, broker_cid)
    print("MEASURE broker " + json.dumps({k: broker[k] for k in ("pid", "host_uid", "uid", "uid_map", "pidns", "netns")}))
    if len({v["volume"] for v in broker["volumes"]}) != len(BROKER_VOLUMES):
        return {"error": f"the broker does not mount its three volumes: {broker['volumes']}"}
    dirs = {v["volume"]: v["destination"] for v in broker["volumes"]}
    ctx = {"canary": CANARY, "sock_dirs": [dirs["jht-broker-sock"]], "legacy_profile": LEGACY_PROFILE,
           "secret_dirs": {name: [dirs[name]] for name in SECRET_VOLUMES}}
    if not wait_for(lambda: exec_json(engine, broker_cid, str(broker["uid"]), BROKER_SIDE, ctx)
                    .get("sockets", {}).get(dirs["jht-broker-sock"]), 60, 2):
        return {"error": "the broker's socket never appeared"}

    # 10: the first view status starts the copy (design S); the volume is
    # read now, before Chromium opens the copy.
    status = sh([engine, "exec", "-i", broker_cid, "jht-broker-admin", "view", "status"], timeout=90)
    print("MEASURE view-status " + status.stdout.strip()[-300:])
    # The copy may finish after status answers: wait for both files (only
    # while there is a volume), still before view start.
    def copied() -> dict:
        got = read_profile(engine, image)
        done = got.get("volume") is None or all(f"{COPY_DIR}/{f}" in (got.get("files") or {}) for f in COPIED)
        return got if done else {}

    profile = wait_for(copied, 30, 2) or read_profile(engine, image)
    print("MEASURE browser-profile " + json.dumps(profile))

    started = sh([engine, "exec", "-i", broker_cid, "jht-broker-admin", "view", "start", "linkedin-login"], timeout=90)
    try:
        view = json.loads(started.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        view = {"ok": False, "reason": (started.stderr or started.stdout)[-400:]}
    print("MEASURE view-start " + json.dumps({k: v for k, v in view.items() if k != "token"}))
    if not view.get("ok"):
        return {"error": f"the login view did not start: {view.get('reason')}"}

    mains = project_containers(engine)
    chromes = wait_for(lambda: [p for p in host_pids() if chromium_browser(host_argv(p)) and container_of(p, mains)], 30)
    if len(chromes) != 1:
        return {"error": f"{len(chromes)} Chromium browser processes in the project: {chromes}"}
    chromium = process(chromes[0], container_of(chromes[0], mains))
    print("MEASURE chromium " + json.dumps({k: chromium[k] for k in ("pid", "host_uid", "uid", "uid_map", "pidns", "netns")})
          + f" same-container={chromium['container'] == broker_cid}")

    # Who listens in the network namespace Chromium sees.
    ss = sh(["sudo", "nsenter", "-t", str(chromium["pid"]), "-n", "ss", "-H", "-l", "-t", "-u", "-x", "-n", "-p"])
    rows = [r for r in parse_ss(ss.stdout) if listener_kind(r)]
    for row in rows:
        row["containers"] = sorted({container_of(p, mains) or "?" for p in row["pids"]})
        row["websockify"] = any(websockify(host_argv(p)) for p in row["pids"])
    print("MEASURE listeners " + json.dumps([{"line": r["line"], "broker": broker_cid in r["containers"]} for r in rows]))
    ws_rows = [r for r in rows if r["websockify"] and r["netid"] == "tcp"]
    ws_port = int(ws_rows[0]["local"].rsplit(":", 1)[1]) if ws_rows else int(view.get("port") or 6081)
    broker_listeners = [r["line"] for r in rows if broker_cid in r["containers"]
                        and not (r["websockify"] and r["netid"] == "tcp")]
    unattributed = [r["line"] for r in rows if not r["pids"]]

    # The host's own connection, with the issued token, before it expires.
    # While it is open, websockify's own connection to the VNC server is the
    # declared VNC (9).
    def established() -> str:
        return sh(["sudo", "nsenter", "-t", str(chromium["pid"]), "-n", "ss", "-H", "-t", "-x", "-n", "-p"]).stdout

    control, live = websocket_with_token(int(view.get("port") or 6081), view["token"], while_open=established)
    vnc_target = declared_vnc(parse_ss(live), lambda p: websockify(host_argv(p)), ws_port)
    print("MEASURE websockify-control " + json.dumps(control) + f" declared-vnc={vnc_target}")
    ctx["tcp_listeners"] = sorted({r["local"] for r in rows if r["netid"] == "tcp"})

    ctx["ws_port"] = ws_port
    user = f"{chromium['uid']}:{chromium['gid']}"
    attack = exec_json(engine, chromium["container"], user, ATTACK, ctx)
    print("MEASURE attack " + json.dumps({k: v for k, v in attack.items() if k != "mountinfo"}))
    broker_side = exec_json(engine, broker_cid, str(broker["uid"]), BROKER_SIDE, ctx)
    print("MEASURE broker-side " + json.dumps({k: v for k, v in broker_side.items() if k != "mountinfo"}))
    if engine == "podman":
        print(f"MEASURE uid-map broker-host-uid={broker['host_uid']} mapped-in-chromium-ns="
              f"{inside_id(broker['host_uid'], chromium['uid_map'])}")
    yama = Path("/proc/sys/kernel/yama/ptrace_scope")
    print(f"MEASURE yama-ptrace-scope={yama.read_text().strip() if yama.exists() else 'absent'}")
    return {"broker": broker, "chromium": chromium, "attack": attack, "broker_side": broker_side,
            "broker_listeners": broker_listeners, "unattributed_listeners": unattributed,
            "websockify_listening": bool(ws_rows), "websockify_control": control,
            "declared_vnc": vnc_target, "browser_profile": profile, "seeded": seed}


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[0] not in ("docker", "podman"):
        print(__doc__, file=sys.stderr)
        return 2
    engine, image, files = argv[0], argv[1], argv[2:]
    try:
        facts = collect(engine, image, files)
    finally:
        sh([*compose_cmd(engine, files), "down", "-v", "--remove-orphans"], timeout=300,
           env={**os.environ, "JHT_IMAGE": image})
    fails = verdict(facts, engine)
    for tag, message in fails:
        print(f"FAIL [{tag}] {message}")
    print(f"checks done: {len(fails)} failed")
    tags = {tag for tag, _ in fails}
    declared = EXPECTED_RED_TODAY[engine]
    if tags == declared:
        print(f"RED as declared for today's design (Chromium in the broker): {sorted(tags)}")
    elif tags:
        print(f"RED, not as declared for today's design: unexpected {sorted(tags - declared)}, "
              f"green {sorted(declared - tags)}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
