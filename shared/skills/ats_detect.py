#!/usr/bin/env python3
"""Identify the applicant tracking system behind a job URL or rendered DOM.

Detection is deliberately deterministic.  The CLOSER chooses a browser recipe
from this result, so a plausible guess is worse than ``unknown``: it could make
the wrong recipe interact with a real application form.

The URL check compares parsed host names, never substrings.  In particular,
``job-boards.greenhouse.io.attacker.invalid`` is not Greenhouse.  DOM markers
are vendor-owned ids/classes or accessibility labels observed on rendered
forms; generic words such as "apply" are not evidence.

CLI::

    python3 ats_detect.py URL [--dom-file rendered.html]

Exit 0 means a platform was identified, exit 1 means unknown/conflicting
evidence, and exit 2 is invalid input.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from dataclasses import asdict, dataclass
from pathlib import Path


UNKNOWN = "unknown"


@dataclass(frozen=True)
class AtsDetection:
    platform: str
    confidence: str
    evidence: tuple[str, ...] = ()
    url_match: bool = False
    dom_match: bool = False
    conflict: bool = False

    def to_dict(self) -> dict:
        value = asdict(self)
        value["evidence"] = list(self.evidence)
        return value


def _is(host: str, domain: str) -> bool:
    """True for a domain and its subdomains, on DNS label boundaries."""
    return host == domain or host.endswith("." + domain)


def _platform_for_host(host: str) -> str | None:
    # These three hosts are all live in the measured operator workload.  Keep
    # them explicit: the EU board is a sibling, not a subdomain of the US one.
    if host in {
        "job-boards.greenhouse.io",
        "job-boards.eu.greenhouse.io",
        "boards.greenhouse.io",
    }:
        return "greenhouse"
    if host == "jobs.ashbyhq.com":
        return "ashby"
    if host in {"jobs.lever.co", "jobs.eu.lever.co"}:
        return "lever"
    if host == "jobs.smartrecruiters.com":
        return "smartrecruiters"
    if _is(host, "myworkdayjobs.com") or _is(host, "myworkdaysite.com"):
        return "workday"
    if _is(host, "successfactors.com") or _is(host, "successfactors.eu"):
        return "successfactors"
    if _is(host, "taleo.net"):
        return "taleo"
    if _is(host, "icims.com"):
        return "icims"
    if _is(host, "recruitee.com"):
        return "recruitee"
    # A LinkedIn job URL is not evidence of Easy Apply: many postings only
    # redirect to an external ATS.  The rendered Easy Apply control below is
    # required before this detector names that recipe.
    return None


_DOM_MARKERS: dict[str, tuple[re.Pattern[str], ...]] = {
    "ashby": (
        re.compile(r"ashby-application-form-(?:form|field-entry|submit-button)", re.I),
        re.compile(r"(?:id|name)=[\"']_systemfield_(?:name|email|resume)[\"']", re.I),
    ),
    "greenhouse": (
        re.compile(r"(?:id=[\"']grnhse_app[\"']|greenhouse-job-board)", re.I),
        re.compile(r"boards-api\.greenhouse\.io", re.I),
        # Greenhouse's current public React board no longer renders the
        # historical grnhse_app container.  Require its paired id/class
        # signature so a generic application form does not name the recipe.
        re.compile(
            r"(?:id=[\"']application-form[\"'][^>]*class=[\"'][^\"']*application--form|"
            r"class=[\"'][^\"']*application--form[^\"']*[\"'][^>]*id=[\"']application-form)",
            re.I,
        ),
    ),
    "lever": (
        re.compile(r"class=[\"'][^\"']*application-form[^\"']*lever", re.I),
        re.compile(r"lever-job-application", re.I),
        # The hosted posting and apply pages: Lever's template submit button
        # class and the resume input id, both vendor names.
        re.compile(r"class=[\"'][^\"']*\btemplate-btn-submit\b", re.I),
        re.compile(r"id=[\"']resume-upload-input[\"']", re.I),
    ),
    "smartrecruiters": (
        re.compile(r"smartrecruiters-(?:job|application)", re.I),
        re.compile(r"jobs\.smartrecruiters\.com", re.I),
    ),
    "workday": (
        re.compile(r"data-automation-id=[\"'](?:jobPostingHeader|applyNowButton)", re.I),
        re.compile(r"myworkdayjobs", re.I),
    ),
    "successfactors": (
        re.compile(r"successfactors", re.I),
        re.compile(r"sap-ui-(?:core|version)", re.I),
    ),
    "taleo": (
        re.compile(r"taleo", re.I),
        re.compile(r"careersection", re.I),
    ),
    "icims": (
        re.compile(r"iCIMS_MainWrapper|icims_content_iframe", re.I),
        re.compile(r"careers\.icims\.com", re.I),
    ),
    "recruitee": (
        re.compile(r"recruitee-(?:careers|jobs|application)", re.I),
        re.compile(r"recruitee\.com", re.I),
    ),
    "linkedin_easy_apply": (
        re.compile(r"aria-label=[\"'][^\"']*easy apply", re.I),
        re.compile(r"jobs-apply-button|easy-apply-modal", re.I),
    ),
}


def _platforms_for_dom(dom: str) -> list[str]:
    if not dom:
        return []
    # A full SPA snapshot can be large.  Vendor markers live in markup and
    # script URLs, so an upper bound protects the detector from accidental
    # multi-megabyte payloads without changing its semantics.
    sample = dom[:5_000_000]
    return [
        platform
        for platform, patterns in _DOM_MARKERS.items()
        if any(pattern.search(sample) for pattern in patterns)
    ]


def detect_ats(url: str | None = None, dom: str | None = None) -> AtsDetection:
    """Return one platform only when URL and DOM evidence do not disagree."""
    raw_url = (url or "").strip()
    host = ""
    url_platform = None
    if raw_url:
        try:
            host = (urllib.parse.urlsplit(raw_url).hostname or "").lower().rstrip(".")
        except ValueError:
            host = ""
        if host:
            url_platform = _platform_for_host(host)

    dom_platforms = _platforms_for_dom(dom or "")
    # Multiple vendor markers are an uncertainty, not a vote.  Embedded forms
    # and copied scripts make this rare but possible.
    if len(dom_platforms) > 1:
        evidence = ([f"url:{host}"] if url_platform else []) + [
            f"dom:{platform}" for platform in dom_platforms
        ]
        return AtsDetection(
            UNKNOWN,
            "none",
            tuple(evidence),
            url_match=bool(url_platform),
            dom_match=True,
            conflict=True,
        )

    dom_platform = dom_platforms[0] if dom_platforms else None
    if url_platform and dom_platform and url_platform != dom_platform:
        return AtsDetection(
            UNKNOWN,
            "none",
            (f"url:{host}", f"dom:{dom_platform}"),
            url_match=True,
            dom_match=True,
            conflict=True,
        )

    platform = url_platform or dom_platform
    if not platform:
        return AtsDetection(UNKNOWN, "none")

    evidence = []
    if url_platform:
        evidence.append(f"url:{host}")
    if dom_platform:
        evidence.append(f"dom:{dom_platform}")
    return AtsDetection(
        platform,
        "high" if url_platform and dom_platform else "medium",
        tuple(evidence),
        url_match=bool(url_platform),
        dom_match=bool(dom_platform),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default="", help="job or application URL")
    parser.add_argument("--dom-file", type=Path, help="rendered HTML snapshot")
    args = parser.parse_args(argv)

    dom = ""
    if args.dom_file:
        try:
            dom = args.dom_file.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            parser.error(f"cannot read DOM file: {exc}")
    if not args.url and not dom:
        parser.error("provide a URL or --dom-file")

    result = detect_ats(args.url, dom)
    print(json.dumps(result.to_dict(), ensure_ascii=False, sort_keys=True))
    return 0 if result.platform != UNKNOWN else 1


if __name__ == "__main__":
    sys.exit(main())
