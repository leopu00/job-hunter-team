"""boot_cost.py reads the session files of the provider CLIs and says what each role spends right after it starts."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "shared" / "skills" / "boot_cost.py"
spec = importlib.util.spec_from_file_location("boot_cost", SCRIPT)
boot_cost = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot_cost)

NOW = time.time()


def _iso(offset_s: float) -> str:
    return datetime.fromtimestamp(NOW - 3600 + offset_s, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def _codex(home: Path, name: str, role: str, calls: list[tuple[float, int, int, int]]) -> None:
    rows = [{"type": "session_meta", "timestamp": _iso(0), "payload": {"cwd": f"/jht_home/agents/{role}"}},
            {"type": "event_msg", "timestamp": _iso(0), "payload": {"type": "token_count", "info": None}}]
    for at, total_in, cached, out in calls:
        rows.append({"type": "event_msg", "timestamp": _iso(at), "payload": {"type": "token_count", "info": {
            "last_token_usage": {"input_tokens": total_in, "cached_input_tokens": cached, "output_tokens": out,
                                 "reasoning_output_tokens": 0}}}})
    _write(home / ".codex" / "sessions" / "2026" / "10" / "27" / f"rollout-{name}.jsonl", rows)


def _claude(home: Path, name: str, role: str, calls: list[tuple[float, int, int, int, int]]) -> None:
    rows = [{"timestamp": _iso(at), "message": {"usage": {
        "input_tokens": fresh, "cache_creation_input_tokens": created, "cache_read_input_tokens": read,
        "output_tokens": out}}} for at, fresh, created, read, out in calls]
    _write(home / ".claude" / "projects" / f"-jht-home-agents-{role}" / f"{name}.jsonl", rows)


def test_codex_session_first_call_and_first_minutes(tmp_path: Path):
    # first call 40k of context (all fresh: cold cache), then two more in the window, one after it
    _codex(tmp_path, "a", "capitano", [(5, 40_000, 0, 300), (60, 41_000, 40_000, 200), (200, 42_000, 41_000, 100),
                                       (900, 50_000, 49_000, 999)])
    out = boot_cost.measure(tmp_path, NOW - 7200, minutes=5)["roles"]["capitano"]
    assert out["sessions"] == 1 and out["first_call_context_median"] == 40_000
    assert out["calls"] == 3  # the call at 900 s is outside the first 5 minutes
    assert out["fresh_in"] == 40_000 + 1_000 + 1_000
    assert out["cached_in"] == 0 + 40_000 + 41_000
    assert out["out"] == 600


def test_claude_session_cache_creation_counts_as_fresh_input(tmp_path: Path):
    _claude(tmp_path, "s1", "sentinella", [(3, 10, 9_000, 0, 50), (40, 20, 100, 9_000, 70)])
    out = boot_cost.measure(tmp_path, NOW - 7200, minutes=10)["roles"]["sentinella"]
    assert out["first_call_context_median"] == 10 + 9_000
    assert out["fresh_in"] == 10 + 9_000 + 20 + 100 and out["cached_in"] == 9_000 and out["out"] == 120


def test_roles_are_separated_means_and_medians_per_role(tmp_path: Path):
    for i, size in enumerate((10_000, 30_000, 20_000)):
        _codex(tmp_path, f"m{i}", "scout", [(2, size, 0, 100)])
    _codex(tmp_path, "z", "mentor", [(2, 4_000, 0, 10)])
    report = boot_cost.measure(tmp_path, NOW - 7200, minutes=10)["roles"]
    assert report["scout"]["sessions"] == 3 and report["scout"]["first_call_context_median"] == 20_000
    assert report["mentor"]["first_call_context_median"] == 4_000


def test_a_name_that_is_not_a_role_and_a_session_older_than_the_period_are_not_counted(tmp_path: Path):
    _codex(tmp_path, "x", "somebody-else", [(2, 5_000, 0, 1)])
    _codex(tmp_path, "old", "scout", [(2, 5_000, 0, 1)])
    assert boot_cost.measure(tmp_path, NOW - 600, minutes=10)["roles"] == {}  # both began 1 h ago
    assert boot_cost.role_of("analista-3") == "analista" and boot_cost.role_of("critico_S2") == "critico"
    assert boot_cost.role_of("?unknown") is None and boot_cost.role_of(None) is None


def test_it_prints_numbers_and_role_names_only(tmp_path: Path):
    _codex(tmp_path, "a", "capitano", [(5, 40_000, 0, 300)])
    # a line that carries text of the conversation must never reach the output
    path = next((tmp_path / ".codex").rglob("rollout-a.jsonl"))
    path.write_text(path.read_text(encoding="utf-8")
                    + json.dumps({"type": "response_item", "timestamp": _iso(6), "payload": {"text": "SECRET-CV-TEXT"}}) + "\n",
                    encoding="utf-8")
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "--hours", "3", "--json"],
                          capture_output=True, text=True, env=env, timeout=60, check=False)
    assert done.returncode == 0 and "SECRET-CV-TEXT" not in done.stdout + done.stderr and str(tmp_path) not in done.stdout
    assert json.loads(done.stdout)["roles"]["capitano"]["first_call_context_median"] == 40_000
    table = subprocess.run([sys.executable, "-I", str(SCRIPT), "--hours", "3"],
                           capture_output=True, text=True, env=env, timeout=60, check=False).stdout
    assert "capitano" in table and "first call" in table


def test_empty_home_is_an_empty_report_not_an_error(tmp_path: Path):
    assert boot_cost.measure(tmp_path, NOW - 7200, minutes=10) == {"minutes": 10, "roles": {}}
    assert "no session started" in boot_cost.render(boot_cost.measure(tmp_path, NOW - 7200, minutes=10))


def test_a_link_in_the_session_folders_is_not_followed(tmp_path: Path):
    outside = tmp_path / "outside"
    _codex(outside, "s", "capitano", [(2, 5_000, 0, 1)])
    target = next((outside / ".codex").rglob("rollout-s.jsonl"))
    folder = tmp_path / "home" / ".codex" / "sessions" / "2026" / "10" / "27"
    folder.mkdir(parents=True)
    (folder / "rollout-link.jsonl").symlink_to(target)  # a file link
    claude = tmp_path / "home" / ".claude" / "projects"
    claude.mkdir(parents=True)
    _claude(outside, "c", "scout", [(2, 1, 0, 0, 1)])
    (claude / "-jht-home-agents-scout").symlink_to(outside / ".claude" / "projects" / "-jht-home-agents-scout")  # a folder link
    assert boot_cost.measure(tmp_path / "home", NOW - 7200, minutes=10)["roles"] == {}
    # the same files, there for real, are read
    _codex(tmp_path / "home", "real", "capitano", [(2, 5_000, 0, 1)])
    assert "capitano" in boot_cost.measure(tmp_path / "home", NOW - 7200, minutes=10)["roles"]


def test_a_file_over_the_size_bound_is_not_read(tmp_path: Path, monkeypatch):
    _codex(tmp_path, "big", "capitano", [(2, 5_000, 0, 1)])
    monkeypatch.setattr(boot_cost, "MAX_SESSION_BYTES", 10)
    assert boot_cost.measure(tmp_path, NOW - 7200, minutes=10)["roles"] == {}


# ── --calls: where a role's first minutes go, by program name ─────────────────────────────────

def _codex_calls(home: Path, name: str, role: str, steps: list) -> None:
    """steps: ("model", at, total_in, cached, out) or ("tool", {payload})."""
    rows = [{"type": "session_meta", "timestamp": _iso(0), "payload": {"cwd": f"/jht_home/agents/{role}"}},
            {"type": "event_msg", "timestamp": _iso(0), "payload": {"type": "token_count", "info": None}}]
    for step in steps:
        if step[0] == "tool":
            rows.append({"type": "response_item", "timestamp": _iso(1), "payload": step[1]})
        else:
            _, at, total_in, cached, out = step
            rows.append({"type": "event_msg", "timestamp": _iso(at), "payload": {"type": "token_count", "info": {
                "last_token_usage": {"input_tokens": total_in, "cached_input_tokens": cached, "output_tokens": out,
                                     "reasoning_output_tokens": 0}}}})
    _write(home / ".codex" / "sessions" / "2026" / "10" / "27" / f"rollout-{name}.jsonl", rows)


def _shell(command) -> dict:
    return {"type": "function_call", "name": "shell", "arguments": json.dumps({"command": command})}


def test_programs_are_names_only_never_an_argument_or_a_word_of_a_text():
    pin = boot_cost.programs_in
    assert pin(["bash", "-lc", "python3 /app/shared/skills/captain_diary.py handoff"]) == ["captain_diary.py"]
    assert pin("python3 /app/x/db_query.py recent-activity --since 2h | head -50") == ["db_query.py", "head"]
    assert pin("cd /app && JHT_HOME=/x python3 -I first_run.py status; tmux list-sessions") == ["cd", "first_run.py", "tmux"]
    assert pin("cat <<'EOF'\nSECRET words here\nEOF") == ["cat"]
    assert pin('echo "line one\nSECRETWORD two" && ls') == ["echo", "ls"]
    assert pin("python3 -c 'import os; SECRET()'") == ["python3"]
    assert pin("timeout 30 node /app/cli/bin/jht.js team status") == ["jht.js"]
    assert pin("sed -n 1,40p /jht_home/profile/candidate_profile.yml") == ["sed"]
    assert pin(None) == [] and pin(12) == [] and pin("") == []


def test_the_fresh_input_goes_to_the_programs_run_just_before_the_call(tmp_path: Path):
    for i in range(2):
        _codex_calls(tmp_path, f"c{i}", "capitano", [
            ("model", 2, 40_000, 0, 100),                                         # the prompt
            ("tool", _shell(["bash", "-lc", "python3 /app/shared/skills/captain_diary.py handoff"])),
            ("model", 10, 49_000, 40_000, 50),                                    # 9 000 fresh from the handoff
            ("tool", _shell("python3 /app/shared/skills/db_query.py x | head")),
            ("tool", _shell("tmux list-sessions")),
            ("model", 20, 57_000, 49_000, 70),                                    # 8 000 fresh, split in three
            ("model", 30, 57_500, 57_000, 10),                                    # follows no tool
            ("model", 9999, 99_999, 0, 1),                                        # outside the window
        ])
    report = boot_cost.measure_calls(tmp_path, NOW - 7200, minutes=5, role="capitano")
    programs = report["programs"]
    assert report["sessions"] == 2
    assert programs["(prompt)"]["fresh_in"] == 40_000 and programs["(prompt)"]["uses"] == 1
    assert programs["captain_diary.py"]["fresh_in"] == 9_000
    assert programs["db_query.py"]["fresh_in"] == programs["head"]["fresh_in"] == programs["tmux"]["fresh_in"] == 2666
    assert programs["(no tool)"]["fresh_in"] == 500
    assert report["out"] == 100 + 50 + 70 + 10
    assert abs(sum(p["share"] for p in programs.values()) - 1) < 0.01
    assert next(iter(programs)) == "(prompt)"  # largest first


def test_a_claude_response_written_as_several_lines_is_one_call(tmp_path: Path):
    usage = {"input_tokens": 5, "cache_creation_input_tokens": 1_000, "cache_read_input_tokens": 0, "output_tokens": 20}
    rows = [
        {"timestamp": _iso(1), "message": {"id": "m1", "usage": usage, "content": [{"type": "text", "text": "SECRET"}]}},
        {"timestamp": _iso(1), "message": {"id": "m1", "usage": usage, "content": [
            {"type": "tool_use", "name": "Bash", "input": {"command": "python3 /app/shared/skills/first_run.py status"}}]}},
        {"timestamp": _iso(1), "message": {"id": "m1", "usage": usage, "content": [
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/jht_home/profile/SECRET.yml"}}]}},
        {"timestamp": _iso(5), "message": {"id": "m2", "usage": {"input_tokens": 3, "cache_creation_input_tokens": 400,
                                                                  "cache_read_input_tokens": 1_000, "output_tokens": 9},
                                           "content": []}},
    ]
    _write(tmp_path / ".claude" / "projects" / "-jht-home-agents-capitano" / "s.jsonl", rows)
    report = boot_cost.measure_calls(tmp_path, NOW - 7200, minutes=5, role="capitano")
    assert report["programs"]["(prompt)"]["fresh_in"] == 1_005 and report["programs"]["(prompt)"]["uses"] == 1
    assert report["programs"]["first_run.py"]["fresh_in"] == report["programs"]["Read"]["fresh_in"] == 201
    assert "SECRET" not in json.dumps(report) and report["out"] == 29
    assert boot_cost.measure(tmp_path, NOW - 7200, minutes=5)["roles"]["capitano"]["calls"] == 2  # not 4


def test_the_command_line_prints_only_names_and_numbers(tmp_path: Path):
    _codex_calls(tmp_path, "c", "capitano", [
        ("model", 2, 1_000, 0, 1), ("tool", _shell("cat /jht_home/profile/SECRET-NAME.yml")), ("model", 4, 3_000, 1_000, 1)])
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "--calls", "capitano", "--hours", "3"],
                          capture_output=True, text=True, env=env, timeout=60, check=False)
    assert done.returncode == 0 and "cat" in done.stdout and "(prompt)" in done.stdout
    assert "SECRET" not in done.stdout + done.stderr and str(tmp_path) not in done.stdout
    bad = subprocess.run([sys.executable, "-I", str(SCRIPT), "--calls", "../etc"], capture_output=True, text=True,
                         env=env, timeout=60, check=False)
    assert bad.returncode == 2 and "SECRET" not in bad.stdout
    assert "no session" in boot_cost.render_calls(boot_cost.measure_calls(tmp_path, NOW - 7200, 5, "scout"))


def test_a_tool_that_takes_code_is_named_by_the_tool_and_none_of_its_words_come_out():
    tool = boot_cost._tool_programs
    assert tool({"type": "custom_tool_call", "name": "exec", "input": "const SECRETVAR = await read('/jht_home/x');"}) == ["exec"]
    assert tool({"type": "function_call", "name": "wait", "arguments": "{}"}) == ["wait"]
    # the shell commands an `exec` hands to exec_command are read like any command line; nothing else of its code is
    code = ('const SECRETVAR = 1;\nconst r = await tools.exec_command({cmd:"sed -n \'1,80p\' /jht_home/maria/x.md", workdir:"/w"});\n'
            "const q = await tools.exec_command({cmd: 'python3 /app/shared/skills/first_run.py status'});\n"
            'const z = await tools.exec_command({cmd:"cat /a/b && maria_tool --token abc"});')
    assert tool({"type": "custom_tool_call", "name": "exec", "input": code}) == ["sed", "first_run.py", "cat", "(other)"]
    assert tool({"type": "custom_tool_call", "name": "exec", "input": "const c = `rm -rf ${x}`; tools.exec_command({cmd:c})"}) == ["exec"]
    assert tool({"type": "custom_tool_call", "name": "exec", "input": 'tools.exec_command({cmd:"ls " + SECRET})'}) == ["ls"]
    assert tool({"type": "custom_tool_call", "name": "exec", "input": "tools.exec_command({cmd:\"unterminated"}) == ["exec"]
    assert tool({"type": "function_call", "name": "x y z", "arguments": "not json"}) == ["(tool)"]
    assert tool({"type": "function_call", "name": "shell", "arguments": json.dumps({"cmd": "ls -la /secret"})}) == ["ls"]
    assert tool({"type": "local_shell_call", "action": {"command": ["git", "status"]}}) == ["git"]


# ── the closed vocabulary: a name somebody chose is never printed ─────────────────────────────

@pytest.mark.parametrize("command, secret", [
    ("sudo -u maria_rossi psql", "maria_rossi"),
    ("timeout -s KILL 5 make", "KILL"),
    ("env -u HOMEVAR -C /home/maria/work ls", "HOMEVAR"),
    ("xargs -a secret_names.txt rm", "secret_names"),
    ("command -v my_private_tool", "my_private_tool"),
])
def test_the_value_of_a_wrappers_option_is_never_taken_for_the_program(command: str, secret: str):
    names = boot_cost.programs_in(command)
    assert names and secret not in " ".join(names) and all(n in boot_cost._UTILITIES or n.startswith("(") for n in names), names


def test_wrappers_are_looked_through_to_the_program_they_run():
    pin = boot_cost.programs_in
    assert pin("env -u HOMEVAR -C /home/maria/work ls") == ["ls"]
    assert pin("xargs -a secret_names.txt rm") == ["rm"]
    assert pin("timeout -s KILL 5 make") == ["(other)"]      # make is not in the vocabulary
    assert pin("sudo -u maria_rossi psql") == ["(other)"]
    assert pin("timeout 30 python3 /app/shared/skills/first_run.py status") == ["first_run.py"]
    assert pin("nohup setsid ls") == ["ls"] and pin("sudo -u maria env -u X ls") == ["ls"]  # wrappers chain


def test_only_the_closed_vocabulary_comes_out():
    pin = boot_cost.programs_in
    assert pin("my-private-tool --token abc") == ["(other)"]
    assert pin("./deploy.sh --token abc") == ["(other)"]
    assert pin("python3 /home/maria/notes/mine.py") == ["(script)"]      # a script that is not the product's
    assert pin("node /tmp/maria_rossi_script.js") == ["(script)"]
    assert pin("python3 /app/shared/skills/first_run.py status") == ["first_run.py"]
    assert pin("jht team status") == ["jht"]
    assert boot_cost._tool_programs({"type": "function_call", "name": "maria_tool", "arguments": "{}"}) == ["(tool)"]
    assert boot_cost._tool_programs({"type": "custom_tool_call", "name": "exec", "input": "x"}) == ["exec"]
    assert boot_cost._claude_programs({"content": [{"type": "tool_use", "name": "mcp__maria__x", "input": {}}]}) == ["(tool)"]
    assert boot_cost._claude_programs({"content": [{"type": "tool_use", "name": "Read", "input": {}}]}) == ["Read"]


def test_read_from_the_standard_input_it_still_runs_and_names_only_the_vocabulary(tmp_path: Path):
    _codex_calls(tmp_path, "c", "capitano", [
        ("model", 2, 1_000, 0, 1), ("tool", _shell("sudo -u maria_rossi psql")), ("model", 4, 3_000, 1_000, 1)])
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", "-", "--calls", "capitano", "--hours", "3"], input=SCRIPT.read_text(encoding="utf-8"),
                          capture_output=True, text=True, env=env, timeout=60, check=False)
    assert done.returncode == 0, done.stderr
    assert "(other)" in done.stdout and "maria_rossi" not in done.stdout + done.stderr
