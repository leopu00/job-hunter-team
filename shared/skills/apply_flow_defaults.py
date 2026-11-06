"""Gate, notifier, CV, cap and applied-record adapters — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import json
import os
import shutil
import sqlite3
import subprocess
from dataclasses import replace
from pathlib import Path
from typing import Any, Mapping


try:
    from apply_flow_constants import (
        application_answers,
    )
    from apply_flow_errors import (
        FlowError, CvCheckUnavailable,
    )
    from apply_flow_models import (
        Receipt, _DeniedVerdict,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        application_answers,
    )
    from shared.skills.apply_flow_errors import (
        FlowError, CvCheckUnavailable,
    )
    from shared.skills.apply_flow_models import (
        Receipt, _DeniedVerdict,
    )


def _default_gate_checker(**kwargs):
    try:
        from apply_gate import apply_verdict
    except ImportError:
        try:
            from shared.skills.apply_gate import apply_verdict
        except ImportError:
            return _DeniedVerdict(
                "gate_missing",
                "shared/skills/apply_gate.py is unavailable; submission is closed",
            )
    try:
        return apply_verdict(**kwargs)
    except Exception as exc:
        return _DeniedVerdict(
            "gate_error",
            f"the authorisation gate could not decide ({type(exc).__name__})",
        )


def _default_notifier(
    *, position_id: int, message: str, answer_request: Mapping[str, Any] | None = None
) -> str:
    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise FlowError("jht-notify-user is unavailable")
    command = [
        executable,
        "--agent",
        "closer",
        "--kind",
        "question",
        "--position-id",
        str(position_id),
    ]
    if os.environ.get("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY") == "1":
        command.append("--no-telegram")
    if answer_request:
        command.extend(
            [
                "--existing-id",
                str(answer_request["message_id"]),
                "--source-id",
                str(answer_request["source_id"]),
                "--source-action",
                "closer_application_answer",
                "--source-payload",
                json.dumps(answer_request["payload"], ensure_ascii=False, sort_keys=True),
            ]
        )
    command.append(message)
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise FlowError(f"jht-notify-user failed with exit {result.returncode}")
    notification_id = result.stdout.strip().split(maxsplit=1)[0]
    if not notification_id.isdigit():
        raise FlowError("jht-notify-user returned no durable message id")
    return notification_id


def _default_essentials_checker(
    *, profile: Mapping[str, Any], position_id: int, db_path: str | Path | None
) -> list[str]:
    """Ask each missing essential fact once (Telegram first); return what is missing."""
    db = _resolve_db_path(db_path)
    with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
        result = application_answers.ensure_essentials(conn, profile, position_id)
    return list(result["missing"])


def _read_only_essentials(
    *, profile: Mapping[str, Any], position_id: int, db_path: str | Path | None
) -> list[str]:
    """What is missing, without asking: a dry run has no effect on the user."""
    db = _resolve_db_path(db_path)
    if not db.is_file():
        raise FlowError("jobs.db not found")
    with contextlib.closing(
        sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    ) as conn:
        return list(application_answers.check_essentials(conn, profile)["missing"])


def _cv_pdf_check_module():
    try:
        import pdf_layout_check as cv_pdf_check
    except ImportError:
        try:
            from shared.skills import pdf_layout_check as cv_pdf_check
        except ImportError as exc:
            raise CvCheckUnavailable("pdf_layout_check is not installed") from exc
    return cv_pdf_check


def _default_cv_checker(cv_path: Path) -> Mapping[str, Any]:
    """The shared visual check of the CV PDF (`pdf_layout_check.analyze`)."""
    module = _cv_pdf_check_module()
    try:
        return module.analyze(Path(cv_path))
    except module.CheckError as exc:
        raise CvCheckUnavailable(type(exc).__name__) from exc


def _default_cv_previewer(cv_path: Path, target: Path) -> None:
    _cv_pdf_check_module().render_preview(Path(cv_path), Path(target))


def _default_cap_reserver(*, position_id: int, db_path: str | Path | None):
    """One slot of today's cap, atomically, before the irreversible click."""
    try:
        from apply_gate import reserve_daily_slot
    except ImportError:
        try:
            from shared.skills.apply_gate import reserve_daily_slot
        except ImportError:
            return _DeniedVerdict("gate_missing", "shared/skills/apply_gate.py is unavailable; submission is closed")
    try:
        return reserve_daily_slot(position_id, "browser", db_path=str(db_path) if db_path else None)
    except Exception as exc:
        return _DeniedVerdict("cap_unreadable", f"the daily cap could not be reserved ({type(exc).__name__})")


def _default_authorisation_claimer(*, position_id: int, url: str):
    """The broker's authorisation for this send, spent once, for the page's destination."""
    try:
        from apply_gate import claim_verdict
    except ImportError:
        try:
            from shared.skills.apply_gate import claim_verdict
        except ImportError:
            return _DeniedVerdict("gate_missing", "shared/skills/apply_gate.py is unavailable; submission is closed")
    try:
        return claim_verdict(position_id, url=url)
    except Exception as exc:
        return _DeniedVerdict(
            "authorisation_unproven", f"the broker could not give the authorisation ({type(exc).__name__})"
        )


def _resolve_db_path(db_path: str | Path | None) -> Path:
    if db_path:
        return Path(db_path)
    if os.environ.get("JHT_DB"):
        return Path(os.environ["JHT_DB"])
    if os.environ.get("JHT_HOME"):
        return Path(os.environ["JHT_HOME"]) / "jobs.db"
    raise FlowError("no database configured: set JHT_DB or JHT_HOME")


def _default_applied_recorder(
    *, position_id: int, receipt: Receipt, db_path: str | Path | None
) -> None:
    if not receipt.is_valid():
        raise FlowError("refusing to record applied without a complete receipt")
    resolved_db = _resolve_db_path(db_path)
    if not resolved_db.is_file():
        raise FlowError("configured jobs database does not exist")

    # A replay after a process crash is harmless only when the effect is read
    # first.  Do not replace a previous channel or timestamp with a new one.
    with sqlite3.connect(resolved_db) as conn:
        existing = conn.execute(
            "SELECT applied, applied_at, applied_via FROM applications WHERE position_id = ?",
            (position_id,),
        ).fetchone()
        position = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (position_id,)
        ).fetchone()
    if (
        existing
        and existing[0] == 1
        and existing[1]
        and existing[2] == "agent_closer"
        and position
        and position[0] == "applied"
    ):
        return
    if existing and existing[0] == 1:
        raise FlowError("application is already applied through a different channel")

    updater = Path(__file__).with_name("db_update.py")
    env = {**os.environ, "JHT_DB": str(resolved_db), "JHT_AGENT_NAME": "closer"}
    result = subprocess.run(
        [
            sys.executable,
            str(updater),
            "application",
            str(position_id),
            "--applied-at",
            "now",
            "--applied-via",
            "agent_closer",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    if result.returncode != 0:
        raise FlowError(f"db_update rejected the applied transition (exit {result.returncode})")

    # Exit zero is not the effect.  The command must have atomically changed
    # both sides of the funnel before this function returns success.
    with sqlite3.connect(resolved_db) as conn:
        observed = conn.execute(
            "SELECT applied, applied_at, applied_via FROM applications WHERE position_id = ?",
            (position_id,),
        ).fetchone()
        observed_position = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (position_id,)
        ).fetchone()
    if not (
        observed
        and observed[0] == 1
        and observed[1]
        and observed[2] == "agent_closer"
        and observed_position
        and observed_position[0] == "applied"
    ):
        raise FlowError("db_update returned success but the applied transition is absent")
