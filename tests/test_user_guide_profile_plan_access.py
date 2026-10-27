"""The user guides say what `jht profile import`, `jht providers plan` and the app's write access do.

CLI-REFERENCE.md describes the profile the team needs to start, the plans a person declares and
the minimal profile that passes; DESKTOP.md describes a team on a VPS that opens read only and the
write access that survives a restart. Each figure and each name on those pages is read here from
the code that does the thing, not from memory: a plan's price from the registry, the thirty days
from the native constant, the button names from the app's own texts, and the minimal profile is
run through the validator the import uses.
"""

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


CLI = text("docs/guides/CLI-REFERENCE.md")
DESKTOP = text("docs/guides/DESKTOP.md")
VALIDATOR = ROOT / "shared" / "skills" / "validate_profile.py"


def flat(s: str) -> str:
    return re.sub(r"\s+", " ", s)


def plan_registry():
    spec = importlib.util.spec_from_file_location("plan_registry_guide", ROOT / "shared/skills/plan_registry.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def section(doc: str, heading: str) -> str:
    start = doc.index(heading)
    rest = doc[start + len(heading):]
    end = re.search(r"\n#{2,3} ", rest)
    return rest[: end.start()] if end else rest


def minimal_profile() -> str:
    body = section(CLI, "### The candidate profile: `jht profile import` and the minimum")
    block = body.split("**A minimal profile that passes:**")[1]
    return re.search(r"```yaml\n(.*?)```", block, re.S).group(1)


def run_validator(path: Path, *flags: str) -> dict:
    done = subprocess.run(
        [sys.executable, "-I", str(VALIDATOR), str(path), "--json", *flags],
        capture_output=True, text=True, check=False,
    )
    return json.loads(done.stdout)


# ── jht providers plan ───────────────────────────────────────────────────

def test_plan_table_is_the_registry_table_of_codex():
    plans = plan_registry().PLANS["openai"]
    body = section(CLI, "### Choosing your plan")
    rows = re.findall(r"^\| `([a-z0-9-]+)`\s*\| ([^|]+?)\s*\| ([^|]+?)\s*\|$", body, re.M)
    assert [(i, n, p) for i, n, p in rows] == [
        (plan["id"], plan["label"], plan["price"]) for plan in plans
    ]


def test_prolite_is_the_hundred_dollar_plan_which_is_declared_as_pro():
    body = flat(section(CLI, "### Choosing your plan"))
    assert "Codex names your plan **ProLite**" in body
    assert "100 $/month one: declare `pro`" in body
    pro = next(plan for plan in plan_registry().PLANS["openai"] if plan["id"] == "pro")
    assert pro["price"] == "100 $/month"


def test_reading_the_plan_does_not_start_the_container_and_the_guide_says_so():
    # the wrapper answers `jht providers plan` (no id) from the running container and never calls ensure_up
    wrapper = text("scripts/jht-wrapper.sh")
    branch = wrapper.split("  providers)\n", 1)[1].split("\n    ;;", 1)[0]
    reading = branch.split("require_compose_file", 1)[0]
    assert '[ "${2:-}" = plan ] && [ "$#" -eq 2 ]' in reading
    assert "ensure_up" not in reading
    assert "ensure_up" in branch.split("require_compose_file", 1)[1]
    body = flat(section(CLI, "### Choosing your plan"))
    assert "Without an id it only reads, and only while the team is running" in body
    assert "does not start it (`jht up` does)" in body


def test_providers_table_lists_the_plan_command():
    assert re.search(r"^\| `jht providers plan \[id\]`", CLI, re.M)
    assert "plan [id]" in text("cli/src/commands/providers.js")


# ── jht profile import ───────────────────────────────────────────────────

def test_minimal_profile_passes_the_schema_the_import_runs(tmp_path):
    profile = tmp_path / "candidate_profile.yml"
    profile.write_text(minimal_profile(), encoding="utf-8")
    result = run_validator(profile, "--strict")
    assert result["ok"] is True, result


def test_minimal_profile_has_every_field_the_team_needs_to_start(tmp_path):
    profile = tmp_path / "candidate_profile.yml"
    profile.write_text(minimal_profile(), encoding="utf-8")
    missing = run_validator(profile, "--strict", "--minimum")["missing"]
    # experience and education are recommended; the eight required fields must all be there
    assert set(missing) <= {"experience", "education"}, missing


def test_the_eight_required_fields_are_listed_and_in_the_example():
    body = section(CLI, "### The candidate profile: `jht profile import` and the minimum")
    table = body.split("**The eight fields the team needs to start**")[1].split("Experience and education")[0]
    fields = re.findall(r"^\| `([a-z_]+)` \|", table, re.M)
    assert fields == [
        "name", "email", "target_role", "location", "experience_years", "seniority_target", "skills", "languages",
    ]
    example = minimal_profile()
    for field in fields:
        assert re.search(rf"^{field}:", example, re.M), field


def test_has_degree_is_optional_in_the_guide_and_in_the_validator(tmp_path):
    body = flat(section(CLI, "### The candidate profile: `jht profile import` and the minimum"))
    assert "`has_degree` is optional too" in body
    assert "counts as not declared, never as \"no\"" in body
    example = minimal_profile()
    assert not re.search(r"^has_degree:", example, re.M)
    profile = tmp_path / "candidate_profile.yml"
    profile.write_text(example, encoding="utf-8")
    assert run_validator(profile, "--strict", "--minimum")["ok"] is True
    # written, it must be a boolean: the guide says a word is refused
    profile.write_text(example + "has_degree: maybe\n", encoding="utf-8")
    refused = run_validator(profile, "--strict")
    assert refused["ok"] is False and any(e.startswith("has_degree:") for e in refused["errors"]), refused
    profile.write_text(example + "has_degree: false\n", encoding="utf-8")
    assert run_validator(profile, "--strict")["ok"] is True


def test_the_size_limit_is_the_import_constant():
    source = text("cli/src/lib/profile-import.js")
    kib = int(re.search(r"MAX_PROFILE_BYTES\s*=\s*(\d+)\s*\*\s*1024", source).group(1))
    assert f"up to {kib} KiB" in flat(CLI)


def test_the_replaced_profile_is_kept_under_the_name_the_command_writes():
    assert "candidate_profile.yml.prev" in text("cli/src/commands/profile.js")
    assert "`candidate_profile.yml.prev`" in CLI


def test_validate_row_says_it_does_not_check_the_team_minimum():
    # `jht profile validate` never passes --minimum: only the import does.
    assert "--minimum" not in text("cli/src/commands/profile.js").split("function validateAction")[1].split("// shared/skills")[0]
    row = next(line for line in CLI.splitlines() if line.startswith("| `jht profile validate"))
    assert "does not check what the team needs to start" in row


# ── the app: read only and write access ──────────────────────────────────

def test_thirty_days_are_the_native_constant():
    native = text("desktop/src-tauri/src/existing_team_runtime.rs")
    assert "FULL_LINK_MAX_AGE_S: u64 = 30 * 24 * 60 * 60" in native
    assert "up to 30 days" in flat(DESKTOP)


def test_the_buttons_and_rows_are_the_apps_own_words():
    readonly = text("desktop/src/lib/existing-team-readonly.i18n.ts")
    restored = text("desktop/src/shell/write-access-restored.i18n.ts")
    errors = text("desktop/src/lib/error-catalog.ts")
    page = flat(DESKTOP)
    assert 'connectInFull: "Connect with write access"' in readonly
    assert 'connectionReadOnly: "Read only: this connection does not change data"' in readonly
    assert 'assistantOff: "Read only: assistant not active"' in readonly
    assert 'switchToReadOnly: "Switch to read only"' in restored
    assert 'title: "Write access is on for {where}"' in restored
    assert "Confirm and connect" in errors
    for words in (
        "**Connect with write access**",
        "**Read only: this connection does not change data**",
        "**Read only: assistant not active**",
        "**Switch to read only**",
        "**Write access is on for**",
        "**Confirm and connect**",
    ):
        assert words in page, words


def test_what_ends_the_write_access_is_what_the_app_says():
    source = text("desktop/src/shell/write-access-restored.i18n.ts")
    note = re.search(r'title: "Write access is on for \{where\}",\n.*?\n\s*note: "([^"]+)"', source).group(1)
    assert "switch to read only, unlink the team or the team changes version" in note
    assert "when you switch to read only, when you unlink the team, when the team changes version" in flat(DESKTOP)


def test_the_restart_survival_is_native_only_where_the_record_is_kept():
    # The record is written and read back on unix (mode 0600) and on Windows (the ACL of the user only); the guide
    # says so, and says nothing of any other system.
    native = text("desktop/src-tauri/src/existing_team_runtime.rs").replace("\r\n", "\n")
    assert "#[cfg(any(unix, windows))]\npub(crate) fn restore_full_link_at" in native
    assert "#[cfg(any(unix, windows))]\npub(crate) fn remember_full_link_at" in native
    assert "#[cfg(not(any(unix, windows)))]\npub(crate) fn restore_full_link_at" in native
    assert "#[cfg(windows)]\nfn read_full_link_mark" in native and "is_owner_only(&acl, &user)" in native
    assert "On a Mac, on Windows and on Linux the write access you confirmed survives a restart" in flat(DESKTOP)
    section_text = section(DESKTOP, "## 🔗 A team on a VPS: read only and write access")
    assert "only your user and the system may open" in flat(section_text)
    # an elevated administrator owns nothing it creates, and the app keeps no record there: the guide says so
    assert "run the app as an elevated administrator" in flat(section_text)
    assert "the write access is not remembered" in flat(section_text)
    assert "an_elevated_process_keeps_nothing_and_stays_read_only" in native


def test_leaving_the_account_ends_the_write_access_and_the_guide_says_so():
    scope = text("desktop/src-tauri/src/account_scope.rs")
    assert "Leaving an account (signing out, or switching to another one) takes its permission to write away" in scope
    assert "when you sign out or switch to another account" in flat(DESKTOP)


def test_the_guide_does_not_say_every_update_asks_again():
    # The record is keyed by account and candidate: an update does not touch it.
    assert "opens read only again" not in flat(DESKTOP)
    assert "from a version that did not keep the permission" in flat(DESKTOP)
