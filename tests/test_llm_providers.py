"""Test mock per i provider concreti (Claude, OpenAI, Minimax)."""

import sys
import os
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── PROVIDER ANTHROPIC — MOCK ───────────────────────────────


def test_anthropic_provider_complete():
    from shared.llm.providers.anthropic_provider import AnthropicProvider
    from shared.llm.base import CompletionResponse

    mock_block = MagicMock()
    mock_block.type = "text"
    mock_block.text = "Ciao, sono Claude!"

    mock_usage = MagicMock()
    mock_usage.input_tokens = 10
    mock_usage.output_tokens = 5

    mock_resp = MagicMock()
    mock_resp.content = [mock_block]
    mock_resp.model = "claude-sonnet-4-20250514"
    mock_resp.usage = mock_usage
    mock_resp.stop_reason = "end_turn"
    mock_resp.model_dump = MagicMock(return_value={})

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_resp

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        with patch("shared.llm.providers.anthropic_provider.anthropic") as mock_anthropic:
            mock_anthropic.Anthropic.return_value = mock_client
            provider = AnthropicProvider()
            result = provider.complete("test")

    assert isinstance(result, CompletionResponse)
    assert result.content == "Ciao, sono Claude!"
    assert result.provider == "claude"
    assert result.usage["input_tokens"] == 10


def test_anthropic_provider_list_models():
    from shared.llm.providers.anthropic_provider import AnthropicProvider

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        with patch("shared.llm.providers.anthropic_provider.anthropic") as mock_anthropic:
            mock_anthropic.Anthropic.return_value = MagicMock()
            provider = AnthropicProvider()
            models = provider.list_models()

    assert len(models) == 3
    ids = [m.id for m in models]
    assert "claude-sonnet-4-20250514" in ids


# ── PROVIDER OPENAI — MOCK ──────────────────────────────────


def test_openai_provider_complete():
    from shared.llm.providers.openai_provider import OpenAIProvider
    from shared.llm.base import CompletionResponse

    mock_message = MagicMock()
    mock_message.content = "Ciao da GPT!"

    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_choice.finish_reason = "stop"

    mock_usage = MagicMock()
    mock_usage.prompt_tokens = 8
    mock_usage.completion_tokens = 4

    mock_resp = MagicMock()
    mock_resp.choices = [mock_choice]
    mock_resp.model = "gpt-4o"
    mock_resp.usage = mock_usage
    mock_resp.model_dump = MagicMock(return_value={})

    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_resp

    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
        with patch("shared.llm.providers.openai_provider.openai") as mock_openai:
            mock_openai.OpenAI.return_value = mock_client
            provider = OpenAIProvider()
            result = provider.complete("test")

    assert isinstance(result, CompletionResponse)
    assert result.content == "Ciao da GPT!"
    assert result.provider == "openai"


# ── PROVIDER MINIMAX — MOCK ─────────────────────────────────


def test_minimax_provider_complete():
    from shared.llm.providers.minimax_provider import MinimaxProvider
    from shared.llm.base import CompletionResponse

    mock_json = {
        "choices": [{"message": {"content": "Ciao da Minimax!"}, "finish_reason": "stop"}],
        "model": "abab6.5-chat",
        "usage": {"prompt_tokens": 5, "completion_tokens": 3},
    }

    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_json
    mock_resp.raise_for_status = MagicMock()

    with patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key"}):
        with patch("shared.llm.providers.minimax_provider.requests.post", return_value=mock_resp):
            provider = MinimaxProvider()
            result = provider.complete("test")

    assert isinstance(result, CompletionResponse)
    assert result.content == "Ciao da Minimax!"
    assert result.provider == "minimax"
    assert result.usage["input_tokens"] == 5


def test_minimax_provider_error_response():
    from shared.llm.providers.minimax_provider import MinimaxProvider
    from shared.llm.base import ProviderError

    mock_json = {"error": {"message": "Rate limit exceeded"}}
    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_json
    mock_resp.raise_for_status = MagicMock()

    with patch.dict(os.environ, {"MINIMAX_API_KEY": "test-key"}):
        with patch("shared.llm.providers.minimax_provider.requests.post", return_value=mock_resp):
            provider = MinimaxProvider()
            with pytest.raises(ProviderError, match="Rate limit"):
                provider.complete("test")
