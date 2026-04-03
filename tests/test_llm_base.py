"""Test per base types e factory del provider abstraction layer."""

import sys
import os
import json
import tempfile
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── BASE TYPES ──────────────────────────────────────────────


def test_completion_response_defaults():
    from shared.llm.base import CompletionResponse

    resp = CompletionResponse(content="ciao", model="test", provider="test")
    assert resp.content == "ciao"
    assert resp.usage == {}
    assert resp.finish_reason == ""
    assert resp.raw is None


def test_model_info_fields():
    from shared.llm.base import ModelInfo

    m = ModelInfo(id="test-1", name="Test", provider="test", context_window=100_000)
    assert m.id == "test-1"
    assert m.supports_vision is False


def test_provider_error_attributes():
    from shared.llm.base import ProviderError

    err = ProviderError("boom", provider="claude", status_code=429)
    assert err.provider == "claude"
    assert err.status_code == 429
    assert "boom" in str(err)


# ── FACTORY — NORMALIZZAZIONE ───────────────────────────────


def test_normalize_provider_id_aliases():
    from shared.llm.factory import normalize_provider_id

    assert normalize_provider_id("claude") == "claude"
    assert normalize_provider_id("anthropic") == "claude"
    assert normalize_provider_id("SONNET") == "claude"
    assert normalize_provider_id("gpt") == "openai"
    assert normalize_provider_id("chatgpt") == "openai"
    assert normalize_provider_id("minimax") == "minimax"
    assert normalize_provider_id("abab") == "minimax"


def test_normalize_provider_id_unknown():
    from shared.llm.factory import normalize_provider_id
    from shared.llm.base import ProviderError

    with pytest.raises(ProviderError, match="Provider sconosciuto"):
        normalize_provider_id("gemini")


# ── FACTORY — GET_PROVIDER ──────────────────────────────────


def test_get_provider_claude_missing_key():
    from shared.llm.base import ProviderError
    from shared.llm.factory import get_provider

    with patch.dict(os.environ, {}, clear=True):
        env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(ProviderError):
                get_provider("claude")


def test_get_provider_openai_missing_key():
    from shared.llm.base import ProviderError
    from shared.llm.factory import get_provider

    with patch.dict(os.environ, {}, clear=True):
        env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(ProviderError):
                get_provider("openai")


def test_get_provider_minimax_missing_key():
    from shared.llm.base import ProviderError
    from shared.llm.factory import get_provider

    with patch.dict(os.environ, {}, clear=True):
        env = {k: v for k, v in os.environ.items() if k != "MINIMAX_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(ProviderError):
                get_provider("minimax")


# ── FACTORY — DEFAULT PROVIDER ──────────────────────────────


def test_get_default_provider_from_env():
    from shared.llm.factory import get_default_provider

    with patch.dict(os.environ, {"JHT_LLM_PROVIDER": "minimax", "MINIMAX_API_KEY": "test-key"}):
        provider = get_default_provider()
        assert provider.provider_id == "minimax"


def test_get_default_provider_from_config():
    from shared.llm.factory import get_default_provider

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump({"active_provider": "minimax"}, f)
        f.flush()
        config_path = f.name

    try:
        with patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key"}, clear=False):
            env_clean = {k: v for k, v in os.environ.items() if k != "JHT_LLM_PROVIDER"}
            with patch.dict(os.environ, env_clean, clear=True):
                with patch("shared.llm.factory._read_config_provider", return_value="minimax"):
                    provider = get_default_provider()
                    assert provider.provider_id == "minimax"
    finally:
        os.unlink(config_path)


# ── FACTORY — LIST PROVIDERS ────────────────────────────────


def test_list_available_providers_structure():
    from shared.llm.factory import list_available_providers

    with patch.dict(os.environ, {}, clear=True):
        result = list_available_providers()
        assert len(result) == 3
        ids = {r["provider_id"] for r in result}
        assert ids == {"claude", "openai", "minimax"}
        for r in result:
            assert "available" in r
            assert "error" in r
