"""The provider facts the app reads (`providerConfigured`, `providerAuthenticated`) for a team on glm or kimi with an API key.

The three places that compute them (the wrapper of Linux and macOS, the one of Windows and the native read of the app on Windows)
used to count a provider as configured only when it was a subscription, so a team set up with `jht setup --api-key-file` read as «no
provider configured» in the app. The rule now is the watchdog's (.launcher/agent-watchdog.sh, config_ready): on pi, glm / kimi /
moonshot with `auth_method: api_key` is configured, and it is signed in when the key is there (a file reference that is a regular,
non-empty file, another kind of reference, or the key itself).

Each script is cut out of its source, pointed at a temporary home, and run by node on made-up configurations. No real key, no
container, no engine.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _between(text: str, start: str, end: str) -> str:
    begin = text.index(start) + len(start)
    return text[begin : text.index(end, begin)]


def _sh_script() -> str:
    source = (ROOT / "scripts/jht-wrapper.sh").read_text(encoding="utf-8")
    return _between(source, 'metadata="$(docker exec "$container_id" node -e \'\n', "\n' \"$expected_team\"")


def _ps1_script() -> str:
    source = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    return _between(source, "$metadataScript = @'\n", "\n'@")


def _rust_script() -> str:
    source = (ROOT / "desktop/src-tauri/src/onboarding.rs").read_text(encoding="utf-8")
    return _between(source, 'const METADATA: &[u8] = br#"', '"#;')


def _run(variant: str, home: Path) -> list[str]:
    script = {"sh": _sh_script, "ps1": _ps1_script, "rust": _rust_script}[variant]().replace("/jht_home", str(home))
    if variant == "ps1":
        run = subprocess.run([NODE, "-"], input=script, text=True, capture_output=True, timeout=20, check=False)
    else:
        run = subprocess.run([NODE, "-e", script, ""], text=True, capture_output=True, timeout=20, check=False)
    assert run.returncode == 0, run.stderr
    values = run.stdout.split()
    assert len(values) == 3 and set(values) <= {"0", "1"}, run.stdout
    return values


def _home(tmp_path: Path, config: dict) -> Path:
    home = tmp_path / "jht_home"
    home.mkdir()
    (home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    return home


def _file_ref(path: Path) -> dict:
    return {"type": "ref", "source": "file", "path": str(path)}


def _api(provider: str, ref=None, harness: str = "pi", method: str = "api_key") -> dict:
    entry = {"name": provider, "auth_method": method}
    if ref is not None:
        entry["api_key_ref"] = ref
    return {"version": 1, "active_provider": provider, "providers": {provider: entry}, "harness": harness}


VARIANTS = ["sh", "ps1", "rust"]


@pytest.mark.parametrize("variant", VARIANTS)
@pytest.mark.parametrize("provider", ["glm", "kimi"])
def test_a_key_in_the_store_is_a_configured_and_signed_in_provider(tmp_path, variant, provider):
    key = tmp_path / "keys" / f"{provider}.key"
    key.parent.mkdir()
    key.write_text("synthetic-key-for-the-test-0000\n", encoding="utf-8")
    home = _home(tmp_path, _api(provider, _file_ref(key)))
    assert _run(variant, home) == ["1", "1", "0"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_provider_is_configured_but_not_signed_in_when_the_key_file_is_not_there(tmp_path, variant):
    home = _home(tmp_path, _api("glm", _file_ref(tmp_path / "keys" / "glm.key")))
    assert _run(variant, home) == ["1", "0", "0"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_an_empty_key_file_or_a_folder_is_not_a_key(tmp_path, variant):
    empty = tmp_path / "empty.key"
    empty.write_text("", encoding="utf-8")
    assert _run(variant, _home(tmp_path, _api("kimi", _file_ref(empty)))) == ["1", "0", "0"]
    folder = tmp_path / "folder.key"
    folder.mkdir()
    other = tmp_path / "other"
    other.mkdir()
    assert _run(variant, _home(other, _api("kimi", _file_ref(folder)))) == ["1", "0", "0"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_a_relative_key_path_is_not_a_key(tmp_path, variant):
    home = _home(tmp_path, _api("glm", {"type": "ref", "source": "file", "path": "keys/glm.key"}))
    assert _run(variant, home) == ["1", "0", "0"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_a_reference_of_another_kind_counts_like_the_watchdog_counts_it(tmp_path, variant):
    home = _home(tmp_path, _api("glm", {"type": "ref", "source": "env", "id": "ZAI_API_KEY"}))
    assert _run(variant, home) == ["1", "1", "0"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_no_key_at_all_is_configured_without_a_sign_in(tmp_path, variant):
    assert _run(variant, _home(tmp_path, _api("glm"))) == ["1", "0", "0"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_glm_with_a_subscription_or_off_pi_is_not_configured(tmp_path, variant):
    key = tmp_path / "glm.key"
    key.write_text("synthetic-key-for-the-test-0000\n", encoding="utf-8")
    assert _run(variant, _home(tmp_path, _api("glm", _file_ref(key), method="subscription")))[0] == "0"
    other = tmp_path / "other"
    other.mkdir()
    assert _run(variant, _home(other, _api("glm", _file_ref(key), harness="codex")))[0] == "0"


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_subscription_providers_read_as_before(tmp_path, variant):
    config = {"version": 1, "active_provider": "kimi", "providers": {"kimi": {"name": "kimi", "auth_method": "subscription"}}}
    home = _home(tmp_path, config)
    assert _run(variant, home) == ["1", "0", "0"]
    creds = home / ".kimi" / "credentials"
    creds.mkdir(parents=True)
    (creds / "kimi-code.json").write_text("{}", encoding="utf-8")
    (home / "profile").mkdir()
    (home / "profile" / "welcomed.flag").write_text("", encoding="utf-8")
    assert _run(variant, home) == ["1", "1", "1"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_kimi_with_a_key_off_pi_stays_not_configured(tmp_path, variant):
    """The legacy Kimi CLI has no API-key mode: the rule of the three scripts is the watchdog's, pi only."""
    key = tmp_path / "kimi.key"
    key.write_text("synthetic-key-for-the-test-0000\n", encoding="utf-8")
    assert _run(variant, _home(tmp_path, _api("kimi", _file_ref(key), harness="codex")))[0] == "0"
