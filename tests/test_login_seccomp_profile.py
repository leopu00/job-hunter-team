"""The seccomp profile of `jht-login` on Docker (scripts/ci/login_seccomp.py): the default profile of Docker, pinned, plus one rule.

What this keeps fixed is the DIFFERENCE with Docker's default: nothing but the one rule that lets the sandbox of Chromium make its user, pid and
net namespaces, in the same form as the rule Docker has for clone, and none of the calls Docker keeps behind CAP_SYS_ADMIN opened.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("login_seccomp", ROOT / "scripts" / "ci" / "login_seccomp.py")
seccomp = importlib.util.module_from_spec(SPEC)
sys.modules["login_seccomp"] = seccomp
SPEC.loader.exec_module(seccomp)

BASE = json.loads(seccomp.BASE.read_text(encoding="utf-8"))
OURS = json.loads(seccomp.PROFILE.read_text(encoding="utf-8"))
STILL_REFUSED = ("setns", "mount", "umount", "umount2", "pivot_root", "clone3", "ptrace", "bpf", "reboot", "kexec_load")


def rules_naming(profile: dict, name: str) -> list[dict]:
    return [rule for rule in profile["syscalls"] if name in rule.get("names", [])]


def test_the_base_is_the_default_profile_of_moby_at_the_named_commit_byte_for_byte():
    assert seccomp.sha256(seccomp.BASE) == seccomp.BASE_SHA256
    assert re.fullmatch(r"[0-9a-f]{40}", seccomp.MOBY_PROFILES_COMMIT)
    assert seccomp.MOBY_PROFILES_COMMIT in Path(seccomp.__file__).read_text(encoding="utf-8")
    assert BASE["defaultAction"] == "SCMP_ACT_ERRNO"  # Docker's default: what is not listed is refused


def test_the_committed_profile_is_exactly_what_the_builder_writes_from_the_base():
    assert seccomp.PROFILE.read_text(encoding="utf-8") == seccomp.build()


def test_the_difference_with_the_default_is_one_rule_and_nothing_else():
    assert {k: v for k, v in OURS.items() if k != "syscalls"} == {k: v for k, v in BASE.items() if k != "syscalls"}
    assert OURS["syscalls"][:-1] == BASE["syscalls"], "every rule of the default is there, as it was and where it was"
    assert OURS["syscalls"][-1:] == [seccomp.RULE] and len(OURS["syscalls"]) == len(BASE["syscalls"]) + 1
    assert seccomp.added() == [seccomp.RULE]


def test_the_rule_allows_only_clone_and_unshare_and_only_without_the_namespaces_the_sandbox_does_not_make():
    rule = seccomp.RULE
    assert rule["names"] == ["clone", "unshare"] and rule["action"] == "SCMP_ACT_ALLOW"
    (arg,) = rule["args"]
    assert arg["index"] == 0 and arg["op"] == "SCMP_CMP_MASKED_EQ" and "valueTwo" not in arg  # (flags & mask) == 0
    mask = arg["value"]
    for refused in (seccomp.CLONE_NEWNS, seccomp.CLONE_NEWUTS, seccomp.CLONE_NEWIPC, seccomp.CLONE_NEWCGROUP):
        assert mask & refused, "a mount, uts, ipc or cgroup namespace stays refused"
    for allowed in (seccomp.CLONE_NEWUSER, seccomp.CLONE_NEWPID, seccomp.CLONE_NEWNET):
        assert not mask & allowed
    assert mask == 235012096 == 0x0E020000


def test_it_is_the_rule_docker_has_for_clone_with_the_three_namespaces_of_the_sandbox_taken_out_of_the_mask():
    docker_clone = [r for r in BASE["syscalls"] if r.get("names") == ["clone"] and r.get("args") and "s390" not in json.dumps(r.get("excludes", {}))]
    assert docker_clone, "the rule of the default this is modelled on is gone: the base moved"
    docker_mask = docker_clone[0]["args"][0]["value"]
    assert docker_mask == 2114060288
    assert docker_mask == seccomp.REFUSED_STILL | seccomp.CLONE_NEWUSER | seccomp.CLONE_NEWPID | seccomp.CLONE_NEWNET


@pytest.mark.parametrize("name", STILL_REFUSED)
def test_what_docker_keeps_behind_cap_sys_admin_is_not_opened(name):
    assert rules_naming(OURS, name) == rules_naming(BASE, name)


def test_clone3_keeps_answering_enosys_so_that_the_libraries_fall_back_to_clone():
    mine = rules_naming(OURS, "clone3")
    assert mine == rules_naming(BASE, "clone3")
    assert any(r["action"] == "SCMP_ACT_ERRNO" and r.get("errnoRet") == 38 for r in mine)


def test_the_profile_never_turns_the_filter_off():
    text = seccomp.PROFILE.read_text(encoding="utf-8")
    assert "unconfined" not in text and OURS["defaultAction"] == "SCMP_ACT_ERRNO"
    assert not [r for r in OURS["syscalls"] if r.get("action") == "SCMP_ACT_ALLOW" and not r.get("names")]


def test_the_compose_file_never_names_an_unconfined_profile():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "seccomp" not in compose.replace("# ", "#").lower().replace("default seccomp", "") or "unconfined" not in compose
    assert "seccomp=unconfined" not in compose and "seccomp:unconfined" not in compose
