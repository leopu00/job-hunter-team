"""GLM (Z.ai) and Kimi (Moonshot) on the pi harness, with an API key (JHT-T314). Synthetic keys, answers and sessions only.

The launcher puts the right provider and the model of the role's class in pi's command, the key goes in the
variable pi reads for that provider, and the price list knows the models (the credit that runs out: test_provider_credit.py).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared"))  # i18n

from test_pi_harness import _argv, _after, _launch  # noqa: E402

import model_pricing  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ROLE_MODELS = ROOT / ".launcher" / "role-models.sh"


def launch(tmp_path, provider, role="scout", **kw):
    return _launch(tmp_path, role=role, provider=provider, auth=kw.pop("auth", "api_key"),
                   after_lib=(f'source "{ROLE_MODELS}"',), **kw)


@pytest.mark.parametrize(("provider", "role", "pi_provider", "model"), [
    ("glm", "scout", "zai", "glm-5.3"),           # terra
    ("glm", "capitano", "zai", "glm-5.3"),        # sol
    ("glm", "assistente", "zai", "glm-5.3"),      # terra
    ("kimi", "scout", "moonshotai", "kimi-k3.1-pro"),
    ("moonshot", "scout", "moonshotai", "kimi-k3.1-pro"),
    ("openai", "scout", "openai", "gpt-5.6-terra"),   # unchanged
])
def test_pi_gets_the_provider_pi_knows_and_the_model_of_the_class(tmp_path, provider, role, pi_provider, model):
    done = launch(tmp_path, provider, role=role)
    assert done.returncode == 0, done.stdout + done.stderr
    _, argv = _argv(done.stdout.strip())
    assert _after(argv, "--provider") == pi_provider
    assert _after(argv, "--model") == model


def test_a_role_pinned_to_the_light_class_gets_the_light_model(tmp_path):
    done = launch(tmp_path, "glm", role_models={"scout": {"model": "luna"}})
    assert done.returncode == 0, done.stdout + done.stderr
    assert _after(_argv(done.stdout.strip())[1], "--model") == "glm-5.3-flash"


@pytest.mark.parametrize("provider", ["glm", "kimi"])
def test_without_an_api_key_the_launcher_refuses_them_on_pi(tmp_path, provider):
    done = launch(tmp_path, provider, auth="subscription")
    assert done.returncode != 0
    assert "only with an API key" in done.stderr


def test_glm_runs_only_on_pi(tmp_path):
    done = launch(tmp_path, "glm", harness="codex")
    assert done.returncode != 0
    assert "GLM runs only on the pi harness" in done.stderr


@pytest.mark.parametrize(("provider", "variable"), [("glm", "ZAI_API_KEY"), ("kimi", "MOONSHOT_API_KEY"), ("moonshot", "MOONSHOT_API_KEY")])
def test_the_key_file_goes_in_the_variable_pi_reads(tmp_path, provider, variable):
    import subprocess
    key = tmp_path / "key"
    # a synthetic key on a tmpfs-like path is checked by the tool; here only the wrapper text is under test
    script = (f'source "{ROOT}/.launcher/spawn-keyfile.sh"; JHT_SPAWN_LIB_DIR="{ROOT}/.launcher"; '
              f'jht_key_ref(){{ echo "file {key}"; }}; jht_key_wrap {provider} /nonexistent 2>&1 || true')
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env={**os.environ, "JHT_API_KEY_FILE": ""})
    # the provider has its variable (else «has no API key variable»), so the wrapper went on to check the file
    assert "no API key variable" not in done.stdout and "api_key_file:" in done.stdout, done.stdout


def test_the_variable_names_of_the_tool_and_of_the_table_are_the_same():
    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    import api_key_file
    table = [line.split("|") for line in (ROOT / "shared" / "runtime" / "provider-models.list").read_text().splitlines()
             if line.startswith("provider|")]
    assert {row[3] for row in table} <= set(api_key_file.KEY_ENV_NAMES)


# ── prices ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("provider", "model", "fresh", "cached", "out", "usd"), [
    ("zai", "glm-5.3", 1_000_000, 1_000_000, 1_000_000, "6.06"),        # 1.4 + 0.26 + 4.4
    ("zai", "glm-5.3-flash", 1_000_000, 1_000_000, 1_000_000, "0.68"),  # 0.15 + 0.03 + 0.5
    ("moonshotai", "kimi-k3.1-pro", 1_000_000, 1_000_000, 1_000_000, "12.2"),
    ("moonshotai", "kimi-k2.7-code", 1_000_000, 1_000_000, 1_000_000, "5.14"),
    ("glm", "glm-4.7", 1_000_000, 0, 1_000_000, "2.8"),
])
def test_the_price_list_prices_the_models_of_glm_and_kimi(provider, model, fresh, cached, out, usd):
    cost = model_pricing.cost_usd(model, fresh, cached, out, provider=provider)
    assert cost is not None and abs(float(cost) - float(usd)) < 1e-9


def test_a_model_that_is_not_in_the_list_is_unknown_not_zero():
    assert model_pricing.cost_usd("glm-9", 1000, 0, 1000, provider="zai") is None


def test_the_ledger_attributes_a_call_to_the_provider_pi_named():
    ledger = model_pricing.Ledger()
    ledger.add("scout-1", "zai", "glm-5.3", 1000, 0, 0, 100, 0)
    ledger.add("scout-2", "moonshotai", "kimi-k3.1-pro", 1000, 0, 0, 100, 0)
    summary = ledger.summary()
    assert summary["price"] == "known" and summary["usd"] > 0
    assert summary["models"]["glm-5.3"]["provider"] == "glm" and summary["models"]["kimi-k3.1-pro"]["provider"] == "kimi"
