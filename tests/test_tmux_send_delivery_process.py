"""Delivery contract: process; independent cases for file-based scheduling."""

import pytest

from test_tmux_send_delivery_proof import (
    box,
    pane_process,
)


def test_a_bare_shell_in_the_pane_gets_nothing_typed_and_the_sender_is_told(box):
    # the CLI is not there: the shell holds the terminal itself, with no script and no -c
    pane_process(box, "bash", pgid="4242", tpgid="4242", args="-bash")
    done = box.run()
    assert done.returncode == 3, done.stdout + done.stderr
    assert "bare shell" in done.stderr and "Nothing was typed" in done.stderr
    assert box.typed() == [] and box.keys("Enter") == [] and not [c for c in box.calls() if c.startswith("load-buffer")]


@pytest.mark.parametrize("args", ["bash", "/bin/bash --login", "-zsh", "/usr/bin/zsh -l -i"])
def test_every_way_an_interactive_shell_is_started_is_a_bare_shell(box, args):
    pane_process(box, args.split()[0].split("/")[-1].lstrip("-"), args=args)
    assert box.run().returncode == 3
    assert box.typed() == []


def test_the_screen_text_does_not_decide_it_a_shell_looking_screen_with_the_cli_in_front_is_delivered(box):
    # the screen says «$ » but the process in front is the agent's CLI: nothing is refused
    box.put("mode", "shell")
    pane_process(box, "node", args="node /usr/lib/codex")
    done = box.run()
    assert "bare shell" not in done.stderr
    assert box.typed() != []


def test_a_shell_that_is_running_the_launcher_as_a_child_is_a_cli_starting_not_a_bare_shell(box):
    # the interactive shell has a child in front (the launcher): the foreground group is not the shell's own
    pane_process(box, "bash", pgid="4242", tpgid="5100", args="-bash")
    done = box.run()
    assert "bare shell" not in done.stderr
    assert len(box.typed()) == 1 and done.returncode == 0, done.stderr


def test_a_shell_that_is_the_launcher_script_itself_is_a_cli_starting_not_a_bare_shell(box):
    pane_process(box, "bash", args="bash /app/.launcher/start-agent.sh capitano")
    done = box.run()
    assert "bare shell" not in done.stderr
    assert len(box.typed()) == 1 and done.returncode == 0, done.stderr


def test_a_shell_started_with_a_command_is_not_a_bare_shell(box):
    pane_process(box, "sh", args="sh -c exec some-launcher")
    done = box.run()
    assert "bare shell" not in done.stderr and len(box.typed()) == 1


@pytest.mark.parametrize("tpgid", ["", "-1", "?"])
def test_when_the_process_cannot_be_read_the_message_is_delivered_as_before(box, tpgid):
    pane_process(box, "bash", tpgid=tpgid, args="-bash")
    done = box.run()
    assert "bare shell" not in done.stderr
    assert len(box.typed()) == 1
