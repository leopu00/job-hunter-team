"""Run the real per-candidate Scout check when another gate is the subject of a test."""
import json
import re
import subprocess


def checked_position(command, **kwargs):
    command = list(command)
    actor = kwargs.get("env", {}).get("JHT_AGENT_NAME", "")
    found_by = command[command.index("--found-by") + 1] if "--found-by" in command else ""
    if not any(re.fullmatch(r"scout(?:-\d+)?", value) for value in (actor, found_by)):
        return subprocess.run(command, **kwargs)
    for flag, value in (("--jd-text", "Synthetic complete job description."),
                        ("--requirements", "Synthetic requirements.")):
        if flag not in command:
            command.extend((flag, value))
    check = subprocess.run(command + ["--check-only", "--link-verified", "--filters-checked"], **kwargs)
    if check.returncode:
        return check
    token = json.loads(check.stdout)["scout_check"]
    return subprocess.run(command + ["--scout-check", token], **kwargs)
