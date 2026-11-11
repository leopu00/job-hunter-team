"""The browser of the manual LinkedIn sign-in keeps no password, no autofill and no sync (a managed policy baked in the image).

The profile of the sign-in sits under ~/.jht, which the agents read: if the person accepted «Save password?», the password would end up in
Default/Login Data. A managed policy of Chromium wins over any setting of the user.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "shared" / "login" / "chromium-policy.json"
DOCKERFILE = ROOT / "Dockerfile"


def test_the_policy_turns_off_the_password_manager_autofill_and_sync():
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    assert policy["PasswordManagerEnabled"] is False
    assert policy["AutofillAddressEnabled"] is False and policy["AutofillCreditCardEnabled"] is False
    assert policy["SyncDisabled"] is True and policy["BrowserSignin"] == 0


def test_the_image_installs_it_where_chromium_reads_managed_policies_in_every_tier():
    text = DOCKERFILE.read_text(encoding="utf-8")
    runtime = text[text.index("AS runtime"):]
    assert re.search(r"^COPY shared/login/chromium-policy\.json /etc/chromium/policies/managed/jht-login\.json$", runtime, re.M)
    # the runtime stage is the one every tier goes through: not one of the prefix stages
    assert "chromium-policy.json" not in text[:text.index("AS runtime")]


def test_the_sign_in_never_falls_back_to_a_browser_without_its_sandbox():
    sources = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "shared" / "login").glob("*.py"))
    assert "--no-sandbox" not in sources.replace("# --no-sandbox", "")  # the words may be in a comment that says it is never used
