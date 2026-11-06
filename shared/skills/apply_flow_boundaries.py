"""Trusted pages and recipe boundaries — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import sqlite3
import urllib.parse
from typing import Any


try:
    from apply_flow_constants import (
        LOG, GREENHOUSE_HOSTS, LEVER_HOSTS, _MAILTO_APPLY_LABEL,
        _optional_module, application_answers,
    )
    from apply_flow_errors import (
        FlowError, BlockedHuman,
    )
    from apply_flow_page import (
        vacancy_closed_evidence, vacancy_redirected_away, linkedin_vacancy_host,
    )
    from apply_flow_profile import (
        _answer_sources,
    )
    from apply_flow_defaults import (
        _read_only_essentials, _resolve_db_path,
    )
    from apply_flow_ashby import (
        AshbyRecipe,
    )
    from apply_flow_recipes import (
        _optional_module, _recipe_class,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG, GREENHOUSE_HOSTS, LEVER_HOSTS, _MAILTO_APPLY_LABEL,
        _optional_module, application_answers,
    )
    from shared.skills.apply_flow_errors import (
        FlowError, BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        vacancy_closed_evidence, vacancy_redirected_away, linkedin_vacancy_host,
    )
    from shared.skills.apply_flow_profile import (
        _answer_sources,
    )
    from shared.skills.apply_flow_defaults import (
        _read_only_essentials, _resolve_db_path,
    )
    from shared.skills.apply_flow_ashby import (
        AshbyRecipe,
    )
    from shared.skills.apply_flow_recipes import (
        _optional_module, _recipe_class,
    )


class FlowPageMixin:
    def _assert_not_redirected_away(self, page, *, navigated: bool) -> None:
        """Stop before any form work when opening the vacancy landed elsewhere."""
        if navigated and vacancy_redirected_away(self.url, page.url):
            raise BlockedHuman(
                "vacancy_closed",
                "The vacancy URL redirected away from the vacancy (job list, careers or home page)",
                "detect",
            )

    @staticmethod
    def _generic_application_controls(page) -> bool:
        """On a page no recipe knows: any form, or a link or button labelled apply."""
        try:
            if page.locator("form").count():
                return True
            for role in ("button", "link"):
                if page.get_by_role(role, name=_MAILTO_APPLY_LABEL).count():
                    return True
        except Exception:
            return True  # unsure: a closed notice proves nothing here
        return False

    @staticmethod
    def _assert_no_closed_notice(page) -> None:
        """Called only where the page has no form, no Apply control and no email channel.

        There a closed notice is positive evidence.  Next to a form it is not:
        job descriptions say "open until filled" and dates of closing.
        """
        try:
            text = page.locator("body").inner_text(timeout=5_000)
        except Exception:
            return
        language = vacancy_closed_evidence(text)
        if language:
            raise BlockedHuman(
                "vacancy_closed",
                f"The page has no application form and says the vacancy is no longer open (notice language: {language})",
                "detect",
            )

    def _recipe(self, platform: str):
        recipe = _recipe_class(platform)
        if recipe is None:
            raise BlockedHuman(
                "ats_unsupported",
                "Application platform is unknown, conflicting, or has no safe recipe",
                "detect",
            )
        built = recipe(self._profile_with_saved_answers(), self.cv_path)
        built.answer_origins = dict(getattr(self, "answer_origins", {}))
        if callable(getattr(built, "attach", None)):
            # A recipe that works with the user's account needs the flow's
            # home, database and notifier (LinkedIn's session and login code).
            built.attach(self)
        return built

    def _log_dry_run_essentials(self) -> None:
        try:
            missing = _read_only_essentials(
                profile=self.profile, position_id=self.position_id, db_path=self.db_path
            )
        except Exception as exc:
            LOG.warning("dry run: essential facts not readable: %s", type(exc).__name__)
            return
        if missing:
            LOG.warning("dry run: %d essential facts unknown, not asked", len(missing))

    def _profile_with_saved_answers(self) -> dict[str, Any]:
        """The profile with every remembered answer; the database wins over the YAML.

        Also records where each answer comes from (`self.answer_origins`): the
        database says user or agent_inferred; an answer only in the profile is
        the profile.
        """
        merged = dict(self.profile)
        answers = AshbyRecipe._answer_index(self.profile.get("application_answers"))
        origins: dict[str, str] = {}
        try:
            db = _resolve_db_path(self.db_path)
        except FlowError:
            db = None
        if db is not None and db.is_file():
            with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
                # Only the profile FILE is imported: a mapping handed in by a
                # caller is not the user's profile and must not become memory.
                if self.profile_path is not None:
                    application_answers.import_profile_answers(conn, self.profile)
                    conn.commit()
                answers.update(application_answers.load_answers(conn, self.position_id))
                resolve = getattr(application_answers, "answer_origins", None)
                if callable(resolve):
                    origins = _answer_sources(resolve(conn, self.position_id))
        merged["application_answers"] = answers
        self.answer_origins = origins
        return merged

    @staticmethod
    def _page_url_on_hosts(url: str, hosts: frozenset[str]) -> bool:
        try:
            parsed = urllib.parse.urlsplit(url)
            port = parsed.port
        except ValueError:
            return False
        return bool(
            parsed.scheme == "https"
            and (parsed.hostname or "").casefold() in hosts
            and port in {None, 443}
        )

    @staticmethod
    def _greenhouse_page_url_trusted(url: str) -> bool:
        try: from apply_flow_engine import ApplicationFlow
        except ImportError: from shared.skills.apply_flow_engine import ApplicationFlow
        return ApplicationFlow._page_url_on_hosts(url, GREENHOUSE_HOSTS)

    @staticmethod
    def _assert_recipe_page(
        page, platform: str, step: str, *, allow_injected_blank: bool = False, application_url: str = ""
    ) -> None:
        try: from apply_flow_engine import ApplicationFlow
        except ImportError: from shared.skills.apply_flow_engine import ApplicationFlow
        if platform not in {"greenhouse", "lever", "linkedin", "generic"}:
            return
        if allow_injected_blank and page.url == "about:blank":
            return
        if platform == "generic":
            # A company form stays on the company's site: the recipe's own rule
            # (sibling subdomains of one company, tenants of a shared suffix apart).
            module = _optional_module("apply_generic")
            try:
                secure = urllib.parse.urlsplit(page.url).scheme == "https"
            except ValueError:
                secure = False
            if not (secure and module is not None and module.same_site(page.url, application_url)):
                raise BlockedHuman(
                    "application_redirect_untrusted",
                    "The company application page left the company's site during the flow",
                    step,
                )
            return
        if platform == "linkedin":
            try:
                parsed = urllib.parse.urlsplit(page.url)
                trusted = parsed.scheme == "https" and parsed.port in {None, 443} and linkedin_vacancy_host(
                    parsed.hostname or ""
                )
            except ValueError:
                trusted = False
            if not trusted:
                raise BlockedHuman(
                    "linkedin_redirect_untrusted",
                    "The LinkedIn page left LinkedIn during the flow",
                    step,
                )
            return
        if platform == "lever":
            if not ApplicationFlow._page_url_on_hosts(page.url, LEVER_HOSTS):
                raise BlockedHuman(
                    "lever_redirect_untrusted",
                    "Lever redirected outside its public job board hosts",
                    step,
                )
            return
        if not ApplicationFlow._greenhouse_page_url_trusted(page.url):
            raise BlockedHuman(
                "greenhouse_redirect_untrusted",
                "Greenhouse redirected outside its three trusted public hosts",
                step,
            )

    @staticmethod
    def _same_confirmation_origin(
        application_url: str, confirmation_url: str, platform: str
    ) -> bool:
        try:
            original = urllib.parse.urlsplit(application_url)
            final = urllib.parse.urlsplit(confirmation_url)
            original_port = original.port
            final_port = final.port
        except ValueError:
            return False
        if original.scheme not in {"http", "https"} or final.scheme != "https":
            return False
        default_ports = {"http": 80, "https": 443}
        if (
            original_port not in {None, default_ports[original.scheme]}
            or final_port not in {None, default_ports[final.scheme]}
        ):
            return False
        original_host = (original.hostname or "").casefold()
        final_host = (final.hostname or "").casefold()
        if platform == "greenhouse":
            # boards.greenhouse.io currently redirects to job-boards.*.  All
            # three exact hosts are one trusted public ATS boundary; no other
            # greenhouse-looking suffix is accepted.
            return original_host in GREENHOUSE_HOSTS and final_host in GREENHOUSE_HOSTS
        if platform == "lever":
            return original_host in LEVER_HOSTS and final_host == original_host
        return bool(original_host and final_host == original_host)
