"""Real CLI wizard screens in a PTY; Codex, npm and team actions are synthetic."""
from __future__ import annotations

import errno
import json
import os
import select
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PTY_ROWS, PTY_COLS = 40, 120
pytestmark = pytest.mark.skipif(os.name == "nt", reason="POSIX terminal; product runs in the Linux container")


def prepare(tmp_path):
    node = shutil.which("node")
    assert node, "Node is required by the CLI gate"
    home = tmp_path / "home"
    home.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    npm = bin_dir / "npm"
    npm.write_text("#!/bin/sh\nprintf '0.0.0-synthetic\\n'\n", encoding="utf-8")
    npm.chmod(0o755)
    codex = bin_dir / "codex"
    codex.write_text(f"#!{node}\n" + """
import fs from 'node:fs';
import readline from 'node:readline';
fs.writeFileSync(process.env.JHT_HOME + '/fake-codex.pid', String(process.pid));
console.log('FAKE-ARGV ' + JSON.stringify(process.argv.slice(2)));
console.log('FAKE-TTY ' + [process.stdin, process.stdout, process.stderr].map(s => Boolean(s.isTTY)).join(','));
console.log('FAKE-SIZE ' + process.stdout.columns + 'x' + process.stdout.rows);
console.log('https://example.invalid/device SYNTHETIC-CODE');
console.error('SYNTHETIC sign-in waiting');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  if (line.trim() !== 'finish') return;
  fs.mkdirSync(process.env.JHT_HOME + '/.codex', { recursive: true });
  fs.writeFileSync(process.env.JHT_HOME + '/.codex/auth.json', '{}');
  console.log('SYNTHETIC authenticated');
  lines.close();
});
""", encoding="utf-8")
    # ESM is explicit even though the executable has no .mjs suffix.
    (bin_dir / "package.json").write_text('{"type":"module"}', encoding="utf-8")
    codex.chmod(0o755)
    pi = bin_dir / "pi"
    pi.write_text(f"#!{node}\n" + """
import fs from 'node:fs';
import readline from 'node:readline';
fs.writeFileSync(process.env.JHT_HOME + '/fake-pi.pid', String(process.pid));
console.log('FAKE-PI-ARGV ' + JSON.stringify(process.argv.slice(2)));
console.log('FAKE-PI-DIR ' + process.env.PI_CODING_AGENT_DIR);
console.log('FAKE-PI-TTY ' + [process.stdin, process.stdout, process.stderr].map(s => Boolean(s.isTTY)).join(','));
console.log('SYNTHETIC pi waiting for /login');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  if (line.trim() !== 'finish') return;
  fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  fs.writeFileSync(process.env.PI_CODING_AGENT_DIR + '/auth.json', '{"openai":{"type":"oauth"}}');
  console.log('SYNTHETIC pi authenticated');
  lines.close();
});
""", encoding="utf-8")
    pi.chmod(0o755)
    fake_jht = tmp_path / "fake-jht.cjs"
    fake_jht.write_text("process.exit(0);\n", encoding="utf-8")
    env = {**os.environ, "HOME": str(home), "JHT_HOME": str(home), "JHT_NODE_ENTRY": str(fake_jht),
           "PATH": f"{bin_dir}:{Path(node).parent}:/usr/bin:/bin", "JHT_HOST_TYPE": "local",
           "JHT_LANG": "en", "NO_COLOR": "1", "TERM": "xterm"}
    return node, home, env


class WizardTerminal:
    def __init__(self, node, env):
        import fcntl
        import pty
        import struct
        import termios
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", PTY_ROWS, PTY_COLS, 0, 0))
            os.execve(node, [node, str(ROOT / "cli/bin/jht.js"), "setup"], env)
        self.output = b""
        self.status = None

    def read(self):
        if select.select([self.fd], [], [], 0.05)[0]:
            try:
                self.output += os.read(self.fd, 65536)
            except OSError as exc:
                if exc.errno != errno.EIO:
                    raise

    def until(self, text, timeout=20):
        deadline = time.monotonic() + timeout
        while text.encode() not in self.output and time.monotonic() < deadline:
            self.read()
        assert text.encode() in self.output, self.output.decode("utf-8", "replace")

    def send(self, text):
        os.write(self.fd, text)

    def finish(self, timeout=10):
        deadline = time.monotonic() + timeout
        while self.status is None and time.monotonic() < deadline:
            self.read()
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.status = os.waitstatus_to_exitcode(status)
        assert self.status is not None, self.output.decode("utf-8", "replace")
        return self.status

    def close(self):
        # Fixture cleanup only: the whole synthetic PTY session, never a real engine/provider.
        try:
            os.killpg(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        if self.status is None:
            os.waitpid(self.pid, 0)
        os.close(self.fd)


# Codex, and Pi with ChatGPT, are kept in the code for the next release but not offered in this one: the services of a release are
# the one list in shared/runtime/release-providers.js. These sign-in cases run again as soon as Codex is back in it.
_RELEASE = (ROOT / "shared/runtime/release-providers.js").read_text(encoding="utf-8")
codex_not_offered = pytest.mark.skipif(
    "'openai'" not in _RELEASE[_RELEASE.index("RELEASE_PROVIDERS"):_RELEASE.index("RELEASE_HARNESS")],
    reason="Codex is not offered in this release (shared/runtime/release-providers.js)",
)


DOWN = b"\x1b[B"


def answer_language(terminal, keys=b""):
    """The very first question: the language. Enter keeps the one in force."""
    terminal.until("Choose your language")
    terminal.send(keys + b"\r")


def choose_provider(terminal):
    """The question after the language: Codex is where it starts (then GLM and Kimi, with a key). Enter keeps Codex."""
    terminal.until("AI Provider")
    terminal.until("GLM (Z.ai)")
    terminal.send(b"\r")


def choose_access(terminal):
    """Codex only: the ChatGPT subscription (where it starts) or an OpenAI API key. Enter keeps the subscription."""
    terminal.until("How does Codex sign in?")
    terminal.send(b"\r")


def choose_harness(terminal, keys=b""):
    """The first question after the provider: which program runs the agents. Enter keeps codex, DOWN then Enter picks pi."""
    terminal.until("Program that runs the agents")
    terminal.send(keys + b"\r")


def begin_login(terminal):
    answer_language(terminal)
    choose_provider(terminal)
    choose_harness(terminal)
    choose_access(terminal)
    terminal.until("When should the team work?")
    terminal.send(b"\r")
    terminal.until("https://example.invalid/device SYNTHETIC-CODE")
    terminal.until("SYNTHETIC sign-in waiting")
    screen = terminal.output.decode("utf-8", "replace")
    assert 'FAKE-ARGV ["login","--device-auth"]' in screen
    assert "FAKE-TTY true,true,true" in screen
    assert f"FAKE-SIZE {PTY_COLS}x{PTY_ROWS}" in screen
    assert "Waiting here while you sign in" in screen
    assert "jht setup" in screen
    assert "another terminal" not in screen
    return screen


def _wait_for_child_exit(pid, timeout=2.0):
    deadline = time.monotonic() + timeout
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AssertionError(f"Synthetic child PID {pid} still exists after {timeout}s")
        time.sleep(min(0.01, remaining))


@codex_not_offered
def test_codex_code_and_wait_are_visible_in_the_wizard_terminal(tmp_path):
    node, home, env = prepare(tmp_path)
    terminal = WizardTerminal(node, env)
    try:
        screen = begin_login(terminal)
        assert not (home / ".codex/auth.json").exists()
        terminal.send(b"finish\n")
        assert terminal.finish() == 0, terminal.output.decode("utf-8", "replace")
        assert (home / ".codex/auth.json").read_text() == "{}"
        assert "Login codex detected" in terminal.output.decode("utf-8", "replace")
        print("T211 screen (synthetic):\n" + screen)
    finally:
        terminal.close()


@codex_not_offered
def test_ctrl_c_then_setup_reuses_saved_config_and_signs_in_here(tmp_path):
    node, home, env = prepare(tmp_path)
    interrupted = WizardTerminal(node, env)
    try:
        begin_login(interrupted)
        interrupted.send(b"\x03")
        assert interrupted.finish() != 0
        child_pid = int((home / "fake-codex.pid").read_text())
        _wait_for_child_exit(child_pid)
        with pytest.raises(ProcessLookupError):
            os.kill(child_pid, 0)
        assert not (home / ".codex/auth.json").exists()
        saved = json.loads((home / "jht.config.json").read_text())
        assert saved["active_provider"] == "openai"
    finally:
        interrupted.close()
    resumed = WizardTerminal(node, env)
    try:
        answer_language(resumed)
        resumed.until("Keep")
        resumed.send(b"\r")
        resumed.until("https://example.invalid/device SYNTHETIC-CODE")
        resumed.until("SYNTHETIC sign-in waiting")
        resumed.send(b"finish\n")
        assert resumed.finish() == 0, resumed.output.decode("utf-8", "replace")
        assert (home / ".codex/auth.json").read_text() == "{}"
        assert json.loads((home / "jht.config.json").read_text()) == saved
        print("T211 resumed screen (synthetic):\n" + resumed.output.decode("utf-8", "replace"))
    finally:
        resumed.close()


@codex_not_offered
def test_choosing_pi_signs_in_to_pi_here_and_not_to_codex(tmp_path):
    node, home, env = prepare(tmp_path)
    terminal = WizardTerminal(node, env)
    try:
        answer_language(terminal)
        choose_provider(terminal)
        choose_harness(terminal, DOWN)
        terminal.until("Pi signs in to ChatGPT with its own login")
        terminal.until("When should the team work?")
        terminal.send(b"\r")
        terminal.until("SYNTHETIC pi waiting for /login")
        screen = terminal.output.decode("utf-8", "replace")
        assert 'FAKE-PI-ARGV ["-nc","-na","-ns","-ne","--no-mcp"]' in screen
        assert f"FAKE-PI-DIR {home}/.pi/agent" in screen
        assert "FAKE-PI-TTY true,true,true" in screen
        assert "type /login and choose OpenAI (ChatGPT)" in screen
        assert "FAKE-ARGV" not in screen, "codex is not started for a team that runs on pi"
        assert not (home / ".pi/agent/auth.json").exists()
        terminal.send(b"finish\n")
        assert terminal.finish() == 0, terminal.output.decode("utf-8", "replace")
        assert json.loads((home / ".pi/agent/auth.json").read_text()) == {"openai": {"type": "oauth"}}
        assert not (home / ".codex/auth.json").exists()
        assert json.loads((home / "jht.config.json").read_text())["harness"] == "pi"
        shown = terminal.output.decode("utf-8", "replace")
        assert "Pi sign-in found: OpenAI (ChatGPT)" in shown
        assert "choose OpenAI (ChatGPT)" in shown and "Ctrl+C (or type /quit)" in shown
    finally:
        terminal.close()


def test_exit_wait_refuses_a_process_that_stays_alive():
    proc = subprocess.Popen([sys.executable, "-c", "import signal; signal.pause()"])
    try:
        with pytest.raises(AssertionError, match="still exists"):
            _wait_for_child_exit(proc.pid, timeout=0.03)
        assert proc.poll() is None, "The negative control must still be alive at the deadline"
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def test_the_wizard_asks_the_language_first_and_saves_the_answer(tmp_path):
    node, home, env = prepare(tmp_path)
    terminal = WizardTerminal(node, env)
    try:
        answer_language(terminal, DOWN)  # Italiano
        terminal.until("Chiave API di GLM")
        assert json.loads((home / "i18n-prefs.json").read_text(encoding="utf-8")) == {"locale": "it"}
    finally:
        terminal.close()
