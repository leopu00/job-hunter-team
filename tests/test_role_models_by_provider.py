"""The model every role gets on every provider, with the launcher's own functions (burst phase, GLM Flash for the light roles).

What a role runs on is decided in three places that have to agree: the class the role has (role-models.list), the class
a provider gives that role instead (`rolemodel` rows of provider-models.list) and the pin of the person
(`team.role_models.<role>.model` in the config). Measured on a run of the burst, 76 percent of the calls came from the
three roles that read, search and extract: on GLM those are Flash now, and nothing else moves:

  - GLM on pi: scout, analista, sentinella -> glm-5.3-flash; every other role -> glm-5.3; a pin in the config wins, both
    ways (a pin to the strong class on a light role, a pin to the light class on the scorer).
  - Kimi on pi: unchanged for every role (its light model is retired at the end of December: no row, no Flash-like rule).
  - OpenAI (Codex) and Claude: unchanged for every role, and no `rolemodel` row can reach them.

Synthetic configs only; the launcher is run as bash, nothing is started and no key is used.

Run:
    pytest tests/test_role_models_by_provider.py -v
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_pi_harness import _after, _argv, _bash, _clean_env, _launch  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ROLE_MODELS = ROOT / ".launcher" / "role-models.sh"
ROLE_LIST = ROOT / "shared" / "runtime" / "role-models.list"
PROVIDER_LIST = ROOT / "shared" / "runtime" / "provider-models.list"

ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer"]
LIGHT_ROLES_OF_GLM = {"scout", "analista", "sentinella"}
# the class each role has on its own: today's table, written out so a change of it is a decision and not a side effect
CLASS_OF = {"capitano": "sol", "scout": "terra", "analista": "terra", "scorer": "terra", "scrittore": "sol", "critico": "sol",
            "sentinella": "terra", "assistente": "terra", "mentor": "sol", "closer": "terra"}
CODEX_MODEL = {"sol": "gpt-5.6-sol", "terra": "gpt-5.6-terra", "luna": "gpt-5.6-luna"}
KIMI_MODEL = {"sol": "kimi-k3.1-pro", "terra": "kimi-k3.1-pro", "luna": "kimi-k2.7-code"}
GLM_STRONG, GLM_FLASH = "glm-5.3", "glm-5.3-flash"


def pi_model(tmp_path, provider, role, pin=None):
    work = tmp_path / f"{provider}-{role}-{pin or 'nopin'}"
    work.mkdir()
    kw = {"role_models": {role: {"model": pin}}} if pin else {}
    done = _launch(work, role=role, provider=provider, auth="api_key", after_lib=(f'source "{ROLE_MODELS}"',), **kw)
    assert done.returncode == 0, done.stdout + done.stderr
    return _after(_argv(done.stdout.strip())[1], "--model")


def bash_value(snippet):
    done = subprocess.run([_bash(), "-c", f'source "{ROLE_MODELS}"; {snippet}'], capture_output=True, text=True,
                          check=False, env=_clean_env())
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout.strip()


# ── the tables themselves ────────────────────────────────────────────────────────────────────────────────────────

def test_the_class_of_each_role_is_the_one_written_down_here():
    rows = {line.split("|")[1]: line.split("|")[2] for line in ROLE_LIST.read_text(encoding="utf-8").splitlines()
            if line.startswith("role|")}
    assert rows == CLASS_OF, "a role changed class: say so in this table, with the reason"


def test_only_glm_has_rows_for_a_role_and_only_for_the_three_light_roles():
    rows = [line.split("|") for line in PROVIDER_LIST.read_text(encoding="utf-8").splitlines() if line.startswith("rolemodel|")]
    assert {(row[1], row[2]) for row in rows} == {("glm", role) for role in LIGHT_ROLES_OF_GLM}, rows
    assert all(row[3] == "luna" for row in rows), "the light class"


# ── GLM ──────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ROLES)
def test_glm_gives_flash_to_the_three_light_roles_and_the_strong_model_to_the_others(tmp_path, role):
    assert pi_model(tmp_path, "glm", role) == (GLM_FLASH if role in LIGHT_ROLES_OF_GLM else GLM_STRONG)


@pytest.mark.parametrize("role", sorted(LIGHT_ROLES_OF_GLM))
@pytest.mark.parametrize("pin", ["sol", "terra"])
def test_a_pin_to_a_strong_class_beats_the_light_role_of_glm(tmp_path, role, pin):
    assert pi_model(tmp_path, "glm", role, pin) == GLM_STRONG


@pytest.mark.parametrize("role", ["scorer", "capitano", "assistente", "closer"])
def test_a_pin_to_the_light_class_gives_flash_to_any_other_role_of_glm(tmp_path, role):
    assert pi_model(tmp_path, "glm", role, "luna") == GLM_FLASH


@pytest.mark.parametrize("role", sorted(LIGHT_ROLES_OF_GLM))
def test_a_pin_to_the_light_class_on_a_light_role_is_flash_as_well(tmp_path, role):
    assert pi_model(tmp_path, "glm", role, "luna") == GLM_FLASH


def test_the_pin_of_one_role_does_not_move_the_others(tmp_path):
    assert pi_model(tmp_path, "glm", "scout", "terra") == GLM_STRONG
    assert pi_model(tmp_path, "glm", "analista") == GLM_FLASH
    assert pi_model(tmp_path, "glm", "scorer") == GLM_STRONG


# ── Kimi, OpenAI, Claude: unchanged ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ROLES)
def test_kimi_is_unchanged_for_every_role(tmp_path, role):
    assert pi_model(tmp_path, "kimi", role) == KIMI_MODEL[CLASS_OF[role]]


@pytest.mark.parametrize("role", ["scout", "analista", "sentinella", "scorer"])
def test_a_pin_on_kimi_is_followed_to_the_letter(tmp_path, role):
    assert pi_model(tmp_path, "kimi", role, "luna") == KIMI_MODEL["luna"]
    assert pi_model(tmp_path, "kimi", role, "sol") == KIMI_MODEL["sol"]


@pytest.mark.parametrize("role", ROLES)
def test_openai_codex_models_are_unchanged_for_every_role(role):
    got = bash_value(f'jht_role_model_value "{CLASS_OF[role]}" codex')
    assert got == CODEX_MODEL[CLASS_OF[role]]


@pytest.mark.parametrize("role", ROLES)
def test_claude_aliases_are_unchanged_for_every_role(role):
    """The legacy alias of a role is the Claude one (`sonnet` for the middle class, none for the strong one)."""
    alias = bash_value(f"get_agent_info {role} | cut -d'|' -f3")
    assert alias == ("sonnet" if CLASS_OF[role] == "terra" else "")


@pytest.mark.parametrize("provider", ["kimi", "moonshot"])
def test_the_light_roles_rule_is_for_glm_alone(provider):
    """jht_provider_model with a role asks the table for a row of THAT provider: no row, the class of the role.
    (OpenAI and Claude never go through it: their tables are pinned by the two tests above.)"""
    name = bash_value(f'jht_pi_api_provider "{provider}"')
    for role in ROLES:
        assert bash_value(f'jht_provider_model "{name}" "{CLASS_OF[role]}" "{role}"') == KIMI_MODEL[CLASS_OF[role]]
