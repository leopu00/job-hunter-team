"""`jht mail setup --password-stdin`: the desktop saves the mailbox password
without a terminal (the Mail screen, and the rotation warning's action).

- no prompt at all: the address and the dedicated/not-dedicated choice come
  as arguments, and the password only as the first line of stdin;
- the password never reaches argv (of the wrapper's children), a log, stdout
  or stderr;
- stdout is exactly one JSON line: the broker's answer, or a fixed error
  (`setup_argument_missing`, `secret_password_missing`) with no broker call;
- the PowerShell wrapper has the same branch (it runs only in Windows CI).

Run with: pytest tests/test_mail_setup_password_stdin.py -v
"""

import json
import re

from test_broker_wrapper import POWERSHELL_WRAPPER, SECRET, host, run  # noqa: F401  (host is a fixture)


def _argv_lines(host):
    return [line for line in host.log.read_text().splitlines() if line.startswith("ARGV ")] if host.log.exists() else []


def test_the_password_comes_from_stdin_with_no_prompt_and_one_json_line(host):
    result = run(host, "mail_setup --password-stdin --user me@example.com --not-dedicated; echo rc=$? >&2",
                 stdin=SECRET + "\r\n")
    assert "rc=0" in result.stderr
    lines = result.stdout.splitlines()
    assert len(lines) == 1 and json.loads(lines[0]) == {"ok": True}
    # No question was asked: nothing but the exit marker on stderr.
    assert result.stderr.strip() == "rc=0"
    assert any("mailbox setup --user me@example.com --admission allowlist" in line for line in _argv_lines(host))
    assert all(SECRET not in line for line in _argv_lines(host))
    assert f"STDIN {SECRET}" in host.log.read_text()  # the carriage return is gone
    assert SECRET not in result.stdout + result.stderr


def test_a_missing_choice_is_an_error_line_not_a_question(host):
    for args in ("--password-stdin --user me@example.com", "--password-stdin --dedicated"):
        result = run(host, f"mail_setup {args}; echo rc=$? >&2", stdin=SECRET + "\n")
        assert json.loads(result.stdout) == {"ok": False, "reason": "setup_argument_missing"}, args
        assert "rc=2" in result.stderr and "?" not in result.stderr and ":" not in result.stderr.replace("rc=2", "")
    assert _argv_lines(host) == []  # the broker was never called


def test_an_empty_stdin_is_an_error_line(host):
    result = run(host, "mail_setup --password-stdin --user me@example.com --dedicated; echo rc=$? >&2", stdin="")
    assert json.loads(result.stdout) == {"ok": False, "reason": "secret_password_missing"}
    assert "rc=1" in result.stderr and _argv_lines(host) == []


def test_a_password_without_a_final_newline_is_read_too(host):
    result = run(host, "mail_setup --password-stdin --user me@example.com --dedicated", stdin=SECRET)
    assert json.loads(result.stdout) == {"ok": True}
    assert f"STDIN {SECRET}" in host.log.read_text()


def test_the_interactive_setup_still_asks(host):
    result = run(host, "mail_setup --user me@example.com --dedicated", stdin=SECRET + "\n")
    assert "Password per app" in result.stderr


def test_the_powershell_wrapper_has_the_same_channel():
    text = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    body = re.search(r"function Invoke-MailSetup \{.*?\n\}\n", text, re.S).group(0)
    branch = body[body.index("if ($fromStdin) {"):body.index("if (-not $user) { $user = Read-Host")]
    assert "'--password-stdin' { $fromStdin = $true }" in body
    assert "[Console]::In.ReadLine()" in branch and "Read-Host" not in branch
    assert '{"ok": false, "reason": "setup_argument_missing"}' in branch
    assert '{"ok": false, "reason": "secret_password_missing"}' in branch
    # The interactive prompt for the password runs only without the flag.
    assert re.search(r"if \(-not \$fromStdin\) \{\s*\$secure = Read-Host", body)
