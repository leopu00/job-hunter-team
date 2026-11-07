"""Reading no sessions is different from failing to read the session list."""

import subprocess
from delivery_status import report


def sessions(*, runner=subprocess.run, home=None):
    try:
        result = runner(["tmux", "list-sessions", "-F", "#{session_name}"], capture_output=True, timeout=5)
        if result.returncode:
            error = result.stderr or b""
            if isinstance(error, bytes):
                error = error.decode("utf-8", "replace")
            missing_socket = ("error connecting to " in error
                              and error.rstrip().endswith("(No such file or directory)"))
            if "no server running" in error or missing_socket:
                return []
            raise RuntimeError("delivery_state_unavailable")
        output = result.stdout
        if isinstance(output, bytes):
            output = output.decode("utf-8", "replace")
        return [line.strip() for line in output.splitlines() if line.strip()]
    except (OSError, subprocess.SubprocessError, RuntimeError):
        report("delivery_state_unavailable", home=home)
        raise
