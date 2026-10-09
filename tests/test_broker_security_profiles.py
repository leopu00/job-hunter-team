"""The jht-broker container's seccomp and AppArmor profiles (design R3, way a).

They are the container defaults of github.com/moby/profiles plus, and only
plus, what Chromium's namespace sandbox needs. These tests pin that: the
seccomp profile minus our two rules is upstream's seccomp/v0.2.4 byte for
byte (canonical JSON), and the AppArmor profile keeps every rule of upstream's
apparmor/v0.2.3 template. Whether the profiles really let the sandbox run is
measured on Linux (the CI job of T1).

Run with: pytest tests/test_broker_security_profiles.py -v
"""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECCOMP = ROOT / "scripts" / "security" / "jht-broker.seccomp.json"
APPARMOR = ROOT / "scripts" / "security" / "jht-broker.apparmor.txt"

# sha256 of moby/profiles seccomp/v0.2.4 default.json, as canonical JSON
# (sort_keys, no spaces).
UPSTREAM_SECCOMP_CANONICAL = "20ef2b6bfd980e7dd56a971d9ec0d71bc0f2d1184415f2d968a19bbcff9ee2b2"
CLONE_NEWUSER, CLONE_NEWPID, CLONE_NEWNET = 0x10000000, 0x20000000, 0x40000000
OTHER_NAMESPACES = 0x00020000 | 0x02000000 | 0x04000000 | 0x08000000  # mount, cgroup, UTS, IPC


def _ours(profile):
    return [rule for rule in profile["syscalls"] if str(rule.get("comment", "")).startswith("jht-broker")]


def test_the_seccomp_profile_is_upstream_plus_our_two_rules():
    profile = json.loads(SECCOMP.read_text())
    ours = _ours(profile)
    assert [rule["names"] for rule in ours] == [["clone"], ["unshare"]]
    upstream = dict(profile, syscalls=[rule for rule in profile["syscalls"] if rule not in ours])
    canonical = json.dumps(upstream, sort_keys=True, separators=(",", ":")).encode()
    assert hashlib.sha256(canonical).hexdigest() == UPSTREAM_SECCOMP_CANONICAL


def test_our_seccomp_rules_open_user_pid_and_net_namespaces_only():
    profile = json.loads(SECCOMP.read_text())
    assert profile["defaultAction"] == "SCMP_ACT_ERRNO"
    for rule in _ours(profile):
        assert rule["action"] == "SCMP_ACT_ALLOW"
        (arg,) = rule["args"]
        assert arg == {"index": 0, "value": OTHER_NAMESPACES, "valueTwo": 0, "op": "SCMP_CMP_MASKED_EQ"}
        for flag in (CLONE_NEWUSER, CLONE_NEWPID, CLONE_NEWNET):
            assert flag & arg["value"] == 0  # allowed: the masked bits stay 0
        assert arg["value"] & 0x00020000  # a mount namespace is still refused
    # clone3 keeps its ENOSYS for non-admins: glibc falls back to clone, which
    # the masks above can inspect.
    clone3 = [r for r in profile["syscalls"] if "clone3" in r["names"] and r["action"] == "SCMP_ACT_ERRNO"]
    assert clone3 and clone3[0]["errnoRet"] == 38


UPSTREAM_APPARMOR_RULES = """
network,
deny network alg,
deny network vsock,
capability,
file,
umount,
signal (receive) peer=unconfined,
signal (receive) peer=runc,
signal (receive) peer=crun,
deny @{PROC}/* w,
deny @{PROC}/{[^1-9/],[^1-9/][^0-9/],[^1-9s/][^0-9y/][^0-9s/],[^1-9/][^0-9/][^0-9/][^0-9/]*}/** w,
deny @{PROC}/sys/[^k]** w,
deny @{PROC}/sys/kernel/{?,??,[^s][^h][^m]**} w,
deny @{PROC}/sysrq-trigger rwklx,
deny @{PROC}/kcore rwklx,
deny mount,
deny /sys/[^f]*/** wklx,
deny /sys/f[^s]*/** wklx,
deny /sys/fs/[^c]*/** wklx,
deny /sys/fs/c[^g]*/** wklx,
deny /sys/fs/cg[^r]*/** wklx,
deny /sys/firmware/** rwklx,
deny /sys/devices/virtual/powercap/** rwklx,
deny /sys/kernel/security/** rwklx,
signal (send,receive) peer=jht-broker,
ptrace (trace,tracedby,read,readby) peer=jht-broker,
""".strip().splitlines()

# Ours, in the jht-broker profile: no `userns,` there (P2-1 of the review).
OUR_APPARMOR_RULES = [
    "abi <abi/4.0>,",
    "unix,",
    'signal (send,receive) peer="jht-broker//&crun",',
    'ptrace (trace,tracedby,read,readby) peer="jht-broker//&crun",',
    "/opt/playwright/chromium-jht/chrome-linux/chrome cx -> chromium,",
    "signal (send) peer=jht-broker//chromium,",
    'signal (send) peer="jht-broker//chromium//&crun",',
]
# The child profile Chromium runs under: upstream's rules for its own label,
# plus `userns,`, which nothing else in the container has.
CHROMIUM_PEERS = {
    "signal (send,receive) peer=jht-broker,": "signal (send,receive) peer=jht-broker//chromium,",
    "ptrace (trace,tracedby,read,readby) peer=jht-broker,": "ptrace (trace,tracedby,read,readby) peer=jht-broker//chromium,",
}
OUR_CHROMIUM_RULES = [
    "unix,",
    "userns,",
    "signal (receive) peer=jht-broker,",
    'signal (receive) peer="jht-broker//&crun",',
    'signal (send,receive) peer="jht-broker//chromium//&crun",',
    'ptrace (trace,tracedby,read,readby) peer="jht-broker//chromium//&crun",',
]
CHILD_HEAD = "profile chromium flags=(attach_disconnected,mediate_deleted) {"


def _rules(text):
    out = []
    for line in text.splitlines():
        line = re.sub(r"\s+#.*$", "", line).strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def _parent_and_child(text):
    rules = _rules(text)
    start = rules.index(CHILD_HEAD)
    end = rules.index("}", start)
    return rules[:start] + rules[end + 1 :], rules[start + 1 : end]


def test_the_apparmor_profile_keeps_every_upstream_rule_and_adds_only_ours():
    parent, _ = _parent_and_child(APPARMOR.read_text())
    assert "profile jht-broker flags=(attach_disconnected,mediate_deleted) {" in parent
    for rule in UPSTREAM_APPARMOR_RULES + OUR_APPARMOR_RULES:
        assert rule in parent, rule
    structural = {"include <tunables/global>", "profile jht-broker flags=(attach_disconnected,mediate_deleted) {", "}"}
    extra = set(parent) - set(UPSTREAM_APPARMOR_RULES) - set(OUR_APPARMOR_RULES) - structural
    assert extra == set()


def test_only_chromium_may_create_user_namespaces():
    # P2-1 of HQ-SICUREZZA's review: the broker's Python and every other
    # process stay without `userns,`; only the exec of Chromium's binary,
    # at the exact path the image gives it, moves to the child profile.
    parent, child = _parent_and_child(APPARMOR.read_text())
    assert "userns," not in parent
    assert "userns," in child
    transitions = [rule for rule in parent if " cx " in rule or " px " in rule or " Cx " in rule or " Px " in rule]
    assert transitions == ["/opt/playwright/chromium-jht/chrome-linux/chrome cx -> chromium,"]
    upstream_for_chromium = [CHROMIUM_PEERS.get(rule, rule) for rule in UPSTREAM_APPARMOR_RULES]
    for rule in upstream_for_chromium + OUR_CHROMIUM_RULES:
        assert rule in child, rule
    assert set(child) - set(upstream_for_chromium) - set(OUR_CHROMIUM_RULES) == set()
    # The image keeps the binary at that exact path.
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "mv \"$revisioned\" /opt/playwright/chromium-jht" in dockerfile
    assert "test -x /opt/playwright/chromium-jht/chrome-linux/chrome" in dockerfile


def test_the_profiles_never_open_more_than_they_name():
    text = APPARMOR.read_text()
    assert "unconfined" not in _rules(text)[0]
    for loosening in ("ptrace,", "signal,", "mount,", "pivot_root", "change_profile", "capability sys_admin"):
        assert loosening not in [r for r in _rules(text) if not r.startswith("deny")], loosening
