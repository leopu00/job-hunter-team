"""Test avanzati shared/llm — stream, error wrapping, system prompt, edge cases."""

import os
import sys
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.llm.base import CompletionResponse, LLMProvider, ModelInfo, ProviderError


# ── BASE — edge cases ─────────────────────────────────────────


def test_completion_response_full_fields():
    resp = CompletionResponse(
        content="risposta", model="m-1", provider="test",
        usage={"input_tokens": 10, "output_tokens": 5},
        finish_reason="end_turn", raw={"id": "x"},
    )
    assert resp.usage["input_tokens"] == 10
    assert resp.finish_reason == "end_turn"
    assert resp.raw["id"] == "x"


def test_provider_error_default_values():
    err = ProviderError("errore generico")
    assert err.provider == ""
    assert err.status_code == 0


def test_model_info_all_capabilities():
    m = ModelInfo(id="m", name="M", provider="p",
                  context_window=200_000, max_output_tokens=32_000,
                  supports_vision=True, supports_tools=True)
    assert m.supports_vision is True
    assert m.supports_tools is True
    assert m.max_output_tokens == 32_000


# ── PROVIDER — repr e get_default_model ────────────────────────


def test_provider_repr():
    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        with patch("shared.llm.providers.anthropic_provider.anthropic") as mock:
            mock.Anthropic.return_value = MagicMock()
            from shared.llm.providers.anthropic_provider import AnthropicProvider
            p = AnthropicProvider()
            r = repr(p)
            assert "AnthropicProvider" in r
            assert "claude" in r


def test_get_default_model_anthropic():
    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        with patch("shared.llm.providers.anthropic_provider.anthropic") as mock:
            mock.Anthropic.return_value = MagicMock()
            from shared.llm.providers.anthropic_provider import AnthropicProvider
            p = AnthropicProvider()
            default = p.get_default_model()
            assert "claude" in default


def test_get_default_model_openai():
    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
        with patch("shared.llm.providers.openai_provider.openai") as mock:
            mock.OpenAI.return_value = MagicMock()
            from shared.llm.providers.openai_provider import OpenAIProvider
            p = OpenAIProvider()
            assert "gpt" in p.get_default_model()


def test_get_default_model_minimax():
    with patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key"}):
        from shared.llm.providers.minimax_provider import MinimaxProvider
        p = MinimaxProvider()
        assert "abab" in p.get_default_model()


# ── FACTORY — get_provider(None) ────────────────────────────────


def test_get_provider_none_calls_default():
    from shared.llm.factory import get_provider
    with patch("shared.llm.factory.get_default_provider") as mock_default:
        mock_default.return_value = MagicMock(provider_id="claude")
        result = get_provider(None)
        mock_default.assert_called_once()
        assert result.provider_id == "claude"


# ── ANTHROPIC — system prompt e error wrapping ──────────────────


def test_anthropic_complete_with_system():
    from shared.llm.providers.anthropic_provider import AnthropicProvider

    mock_block = MagicMock(type="text", text="Con system!")
    mock_usage = MagicMock(input_tokens=15, output_tokens=8)
    mock_resp = MagicMock(content=[mock_block], model="claude-sonnet-4-20250514",
                          usage=mock_usage, stop_reason="end_turn")
    mock_resp.model_dump = MagicMock(return_value={})
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_resp

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test"}):
        with patch("shared.llm.providers.anthropic_provider.anthropic") as mock:
            mock.Anthropic.return_value = mock_client
            p = AnthropicProvider()
            result = p.complete("ciao", system="Sei un assistente")

    call_kwargs = mock_client.messages.create.call_args[1]
    assert call_kwargs["system"] == "Sei un assistente"
    assert result.content == "Con system!"


def test_anthropic_complete_api_error_wrapping():
    from shared.llm.providers.anthropic_provider import AnthropicProvider

    mock_client = MagicMock()
    mock_client.messages.create.side_effect = Exception("Connection timeout")

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test"}):
        with patch("shared.llm.providers.anthropic_provider.anthropic") as mock:
            mock.Anthropic.return_value = mock_client
            p = AnthropicProvider()
            with pytest.raises(ProviderError, match="Connection timeout"):
                p.complete("test")


# ── OPENAI — system prompt e error wrapping ─────────────────────


def test_openai_complete_with_system():
    from shared.llm.providers.openai_provider import OpenAIProvider

    mock_msg = MagicMock(content="Con system GPT!")
    mock_choice = MagicMock(message=mock_msg, finish_reason="stop")
    mock_usage = MagicMock(prompt_tokens=12, completion_tokens=6)
    mock_resp = MagicMock(choices=[mock_choice], model="gpt-4o", usage=mock_usage)
    mock_resp.model_dump = MagicMock(return_value={})
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_resp

    with patch.dict(os.environ, {"OPENAI_API_KEY": "test"}):
        with patch("shared.llm.providers.openai_provider.openai") as mock:
            mock.OpenAI.return_value = mock_client
            p = OpenAIProvider()
            result = p.complete("ciao", system="Sei un helper")

    call_kwargs = mock_client.chat.completions.create.call_args[1]
    msgs = call_kwargs["messages"]
    assert msgs[0]["role"] == "system"
    assert result.content == "Con system GPT!"


def test_openai_complete_api_error_wrapping():
    from shared.llm.providers.openai_provider import OpenAIProvider

    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = Exception("Rate limit")

    with patch.dict(os.environ, {"OPENAI_API_KEY": "test"}):
        with patch("shared.llm.providers.openai_provider.openai") as mock:
            mock.OpenAI.return_value = mock_client
            p = OpenAIProvider()
            with pytest.raises(ProviderError, match="Rate limit"):
                p.complete("test")


def test_openai_list_models():
    from shared.llm.providers.openai_provider import OpenAIProvider

    with patch.dict(os.environ, {"OPENAI_API_KEY": "test"}):
        with patch("shared.llm.providers.openai_provider.openai") as mock:
            mock.OpenAI.return_value = MagicMock()
            p = OpenAIProvider()
            models = p.list_models()
    assert len(models) == 3
    assert any(m.id == "gpt-4o" for m in models)


# ── MINIMAX — error wrapping API ────────────────────────────────


