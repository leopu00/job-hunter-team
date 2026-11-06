#!/usr/bin/env python3
"""Checkpointed, fail-closed application flow for the CLOSER.

The state machine is ``detect -> fill -> upload_cv -> screening -> review ->
submit``.  Every completed step is written atomically to a mode-0600
checkpoint.  Filling steps are replayed idempotently after a browser restart;
submission is different: ``submit_started`` is persisted *before* the click,
and an uncertain outcome is never clicked again.

The complete public-form recipes are Ashby and Greenhouse.  A vacancy whose
application control is a ``mailto:`` link is not a missing form: the flow stops
in ``email_channel`` and records the raw ``mailto_href`` in the checkpoint for
the email channel (``email_application.py``), which owns everything after
that.  A real submit has four hard conditions:

* the phase-A gate allows this position at start and immediately before click;
* every required value comes from the candidate profile (nothing is guessed);
* captcha, 2FA, unknown controls, and upload errors block for a human;
* a screenshot plus a confirmation URL or text exists before ``applied`` is
  recorded.

The module imports Playwright lazily so deterministic checkpoint/detection
tests can still run without starting a browser.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping

if __name__ == "__main__" or __package__ == "shared.skills":
    # Run as a script, this module is `__main__`; a package import has another
    # qualified name. The recipes that live in
    # their own modules (`linkedin_apply`) import it as `apply_flow`: without
    # this line they would get a second copy whose BlockedHuman the flow
    # below never catches.
    sys.modules.setdefault("apply_flow", sys.modules[__name__])


try:
    from apply_flow_constants import (
        LOG, CHECKPOINT_VERSION, SUPPORTED_PLATFORMS, GREENHOUSE_HOSTS,
        LEVER_HOSTS, LINKEDIN_HOSTS, _LINKEDIN_COUNTRY_HOST, STEP_ORDER,
        EMAIL_CHANNEL_STATE, CONTACT_FORM_CHANNEL, RECEIPT_CHANNELS, RETRY_LATER_EXIT,
        _MAILTO_CONTROLS_JS, _MAILTO_APPLY_LABEL, _VACANCY_CLOSED_PATTERNS, _NOTICE_CONDITION,
        _NOTICE_DATE_AFTER, _CORE_PATH_FACTS, ANSWER_ORIGINS, _REFUSED_ANSWER_REASONS,
        MAX_INFERRED_REFUSALS, _CV_REASON, _OPTIONAL_IMPORT_ERRORS, _utc_now,
        _parse_utc, _file_sha256, _optional_module, _linkedin_module,
        detect_ats, application_answers, profile_facts, apply_vocabulary,
        page_failure, location_choice, _NOUNS_EN, _NOUNS_IT,
        _NOUNS_DE, _NOUNS_FR, _NOUNS_ES, _NOUNS_PT,
        _NOUNS_HU, _NEAR,
    )
    from apply_flow_errors import (
        FlowError, _HeadedRetry, BlockedHuman, FlowDeferred,
        PlatformHandoff, CvCheckUnavailable,
    )
    from apply_flow_page import (
        _resolve_headless, _normalise_label, _safe_label, _exact_form_text,
        _control_option_labels, vacancy_closed_evidence, vacancy_redirected_away, mailto_application_href,
        linkedin_vacancy_host, _any_linkedin_host, is_linkedin_job, linkedin_job_url,
        _fill_secret, _secrets_hidden,
    )
    from apply_flow_profile import (
        _profile_fact, _core_fact_missing, _fill_suggested_location, _inferred_answer_refused,
        _value_digest, _answer_fits, _answer_sources,
    )
    from apply_flow_models import (
        Receipt, FlowCheckpoint, FlowResult, _DeniedVerdict,
    )
    from apply_flow_defaults import (
        _default_gate_checker, _default_notifier, _default_essentials_checker, _read_only_essentials,
        _cv_pdf_check_module, _default_cv_checker, _default_cv_previewer, _default_cap_reserver,
        _default_authorisation_claimer, _resolve_db_path, _default_applied_recorder,
    )
    from apply_flow_ashby import (
        AshbyRecipe,
    )
    from apply_flow_recipes import (
        _linkedin_module, _optional_module, _recipe_class,
    )
    from apply_flow_greenhouse import (
        GreenhouseRecipe,
    )
    from apply_flow_lever import (
        LeverRecipe,
    )
    from apply_flow_engine import (
        ApplicationFlow,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG, CHECKPOINT_VERSION, SUPPORTED_PLATFORMS, GREENHOUSE_HOSTS,
        LEVER_HOSTS, LINKEDIN_HOSTS, _LINKEDIN_COUNTRY_HOST, STEP_ORDER,
        EMAIL_CHANNEL_STATE, CONTACT_FORM_CHANNEL, RECEIPT_CHANNELS, RETRY_LATER_EXIT,
        _MAILTO_CONTROLS_JS, _MAILTO_APPLY_LABEL, _VACANCY_CLOSED_PATTERNS, _NOTICE_CONDITION,
        _NOTICE_DATE_AFTER, _CORE_PATH_FACTS, ANSWER_ORIGINS, _REFUSED_ANSWER_REASONS,
        MAX_INFERRED_REFUSALS, _CV_REASON, _OPTIONAL_IMPORT_ERRORS, _utc_now,
        _parse_utc, _file_sha256, _optional_module, _linkedin_module,
        detect_ats, application_answers, profile_facts, apply_vocabulary,
        page_failure, location_choice, _NOUNS_EN, _NOUNS_IT,
        _NOUNS_DE, _NOUNS_FR, _NOUNS_ES, _NOUNS_PT,
        _NOUNS_HU, _NEAR,
    )
    from shared.skills.apply_flow_errors import (
        FlowError, _HeadedRetry, BlockedHuman, FlowDeferred,
        PlatformHandoff, CvCheckUnavailable,
    )
    from shared.skills.apply_flow_page import (
        _resolve_headless, _normalise_label, _safe_label, _exact_form_text,
        _control_option_labels, vacancy_closed_evidence, vacancy_redirected_away, mailto_application_href,
        linkedin_vacancy_host, _any_linkedin_host, is_linkedin_job, linkedin_job_url,
        _fill_secret, _secrets_hidden,
    )
    from shared.skills.apply_flow_profile import (
        _profile_fact, _core_fact_missing, _fill_suggested_location, _inferred_answer_refused,
        _value_digest, _answer_fits, _answer_sources,
    )
    from shared.skills.apply_flow_models import (
        Receipt, FlowCheckpoint, FlowResult, _DeniedVerdict,
    )
    from shared.skills.apply_flow_defaults import (
        _default_gate_checker, _default_notifier, _default_essentials_checker, _read_only_essentials,
        _cv_pdf_check_module, _default_cv_checker, _default_cv_previewer, _default_cap_reserver,
        _default_authorisation_claimer, _resolve_db_path, _default_applied_recorder,
    )
    from shared.skills.apply_flow_ashby import (
        AshbyRecipe,
    )
    from shared.skills.apply_flow_recipes import (
        _linkedin_module, _optional_module, _recipe_class,
    )
    from shared.skills.apply_flow_greenhouse import (
        GreenhouseRecipe,
    )
    from shared.skills.apply_flow_lever import (
        LeverRecipe,
    )
    from shared.skills.apply_flow_engine import (
        ApplicationFlow,
    )


def _load_profile(path: Path) -> Mapping[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise FlowError("pyyaml is not installed") from exc
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise FlowError(f"candidate profile cannot be read: {exc}") from exc
    if not isinstance(value, Mapping):
        raise FlowError("candidate profile is not a mapping")
    return value


def ask_pending_question(
    position_id: int,
    key: str | None = None,
    *,
    db_path: str | Path | None = None,
    checkpoint_path: str | Path | None = None,
    notifier: Callable[..., str] | None = None,
) -> dict[str, str]:
    """The CLOSER's explicit ask: send the form question its flow stopped on.

    The flow never asks by itself.  When the CLOSER finds no basis for an
    answer in the profile, the CV or the vacancy, this creates the durable
    dashboard row and notifies the user once (Telegram first).  `key` must be
    the pending question's key when given.  Returns `{status, source_id}` with
    status asked · already_asked · not_pending; raises FlowError when the
    checkpoint cannot be read or the row cannot be verified.
    """
    pid = int(position_id)
    jht_home = Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
    path = Path(checkpoint_path) if checkpoint_path else jht_home / ".cache" / "apply-flow" / f"{pid}.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "not_pending", "source_id": ""}
    except (OSError, ValueError) as exc:
        raise FlowError(f"checkpoint cannot be read: {type(exc).__name__}") from exc
    url = raw.get("url") if isinstance(raw, dict) else None
    if not isinstance(url, str) or not url:
        raise FlowError("checkpoint has no application url")
    checkpoint = FlowCheckpoint.load(path, pid, url)
    request = checkpoint.answer_request
    payload = request.get("payload") if isinstance(request, Mapping) else None
    pending_key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
    if not pending_key or (key is not None and _normalise_label(key) != pending_key):
        return {"status": "not_pending", "source_id": ""}
    flow = ApplicationFlow(
        position_id=pid,
        url=url,
        profile={},
        cv_path=Path(os.devnull),
        checkpoint_path=path,
        db_path=db_path,
        notifier=notifier,
    )
    return flow.ask_pending(checkpoint)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position-id", type=int, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--cv", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--receipt-dir", type=Path)
    parser.add_argument("--db", type=Path)
    browser_mode = parser.add_mutually_exclusive_group()
    browser_mode.add_argument(
        "--headful", dest="headless", action="store_false", help="Force a visible browser."
    )
    browser_mode.add_argument(
        "--headless", dest="headless", action="store_true", help="Force a hidden browser."
    )
    parser.set_defaults(headless=None)
    parser.add_argument(
        "--ask",
        action="store_true",
        help="Send the form question this position stopped on to the user (the CLOSER found no basis).",
    )
    args = parser.parse_args(argv)

    if args.ask:
        try:
            asked = ask_pending_question(
                args.position_id, db_path=args.db, checkpoint_path=args.checkpoint
            )
        except (FlowError, ValueError, sqlite3.Error) as exc:
            print(json.dumps({"status": "error", "reason": type(exc).__name__}))
            return 2
        print(json.dumps(asked, sort_keys=True))
        return 0 if asked["status"] == "asked" else 3

    try:
        flow = ApplicationFlow(
            position_id=args.position_id,
            url=args.url,
            profile=_load_profile(args.profile),
            profile_path=args.profile,
            cv_path=args.cv,
            checkpoint_path=args.checkpoint,
            receipt_dir=args.receipt_dir,
            db_path=args.db,
            headless=_resolve_headless(args.headless),
        )
        result = flow.run()
    except FlowDeferred as deferred:
        # The LinkedIn profile was taken between the check and the launch.
        print(json.dumps({"status": "denied", "state": "", "reason": deferred.reason, "receipt": None}))
        return 1
    except (FlowError, ValueError) as exc:
        print(json.dumps({"status": "error", "reason": str(exc)}))
        return 2
    print(json.dumps(result.to_dict(), ensure_ascii=False, sort_keys=True))
    if result.status in {"applied", "dry_run"}:
        return 0
    if result.status == "denied":
        return 1
    if result.status == EMAIL_CHANNEL_STATE:
        # Not a failure and not a human block: the email channel takes over
        # from the checkpoint's channel/mailto_href.
        return 4
    if result.status == page_failure.RETRY_LATER_STATE:
        # Not a stop: the page did not answer for now; the queue gives the
        # position back after the checkpoint's retry_after.
        return RETRY_LATER_EXIT
    return 3


if __name__ == "__main__":
    sys.exit(main())
