"""The container environment reaches every agent: it must not carry the key of any provider (each agent gets its own
key from the keyfile at launch)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "MOONSHOT_API_KEY", "ZAI_API_KEY")


def _environment_lines(path: Path):
    return [l for l in path.read_text().splitlines() if re.match(r"\s*-\s*[A-Z_]+=", l)]


def test_the_compose_environment_carries_no_provider_key():
    lines = _environment_lines(ROOT / "docker-compose.yml")
    assert lines, "the environment list was not found"
    assert not [l for l in lines if any(k in l for k in KEYS)]


def test_the_caller_environment_list_of_the_wrapper_has_no_provider_key():
    text = (ROOT / "scripts" / "jht-wrapper.sh").read_text()
    line = next(l for l in text.splitlines() if l.startswith("PODMAN_CALLER_ENV="))
    assert not [k for k in KEYS if k in line]
