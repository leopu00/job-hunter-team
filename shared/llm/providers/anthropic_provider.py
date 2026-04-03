"""Provider Anthropic (Claude) — wrapper SDK anthropic.

Modelli supportati: claude-sonnet-4-20250514, claude-opus-4-20250514, claude-haiku-4-20250506.
Richiede: pip install anthropic
"""

import os
from typing import Iterator, Optional

from shared.llm.base import CompletionResponse, LLMProvider, ModelInfo, ProviderError

try:
    import anthropic
except ImportError:
    anthropic = None  # type: ignore[assignment]

MODELS = [
    ModelInfo(
        id="claude-sonnet-4-20250514",
        name="Claude Sonnet 4",
        provider="claude",
        context_window=200_000,
        max_output_tokens=16_384,
        supports_vision=True,
        supports_tools=True,
    ),
    ModelInfo(
        id="claude-opus-4-20250514",
        name="Claude Opus 4",
        provider="claude",
        context_window=200_000,
        max_output_tokens=32_000,
        supports_vision=True,
        supports_tools=True,
    ),
    ModelInfo(
        id="claude-haiku-4-20250506",
        name="Claude Haiku 4",
        provider="claude",
        context_window=200_000,
        max_output_tokens=8_192,
        supports_vision=True,
        supports_tools=True,
    ),
]

DEFAULT_MODEL = "claude-sonnet-4-20250514"


def _resolve_key() -> str:
    """Risolve API key: credential_manager (Gus) -> env var fallback."""
    try:
        from shared.skills.credential_manager import resolve_api_key
        key = resolve_api_key("claude")
        if key:
            return key
    except ImportError:
        pass
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise ProviderError(
            "ANTHROPIC_API_KEY non configurata. "
            "Imposta la variabile d'ambiente o usa credential_manager.",
            provider="claude",
        )
    return key


class AnthropicProvider(LLMProvider):
    """Provider per Claude via Anthropic API."""

    provider_id = "claude"

    def __init__(self):
        if anthropic is None:
            raise ProviderError(
                "SDK anthropic non installato. Esegui: pip install anthropic",
                provider="claude",
            )
        api_key = _resolve_key()
        self._client = anthropic.Anthropic(api_key=api_key)

    def complete(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> CompletionResponse:
        model = model or DEFAULT_MODEL
        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system

        try:
            resp = self._client.messages.create(**kwargs)
        except Exception as e:
            raise ProviderError(str(e), provider="claude") from e

        content = ""
        for block in resp.content:
            if block.type == "text":
                content += block.text

        return CompletionResponse(
            content=content,
            model=resp.model,
            provider="claude",
            usage={
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
            finish_reason=resp.stop_reason or "",
            raw=resp.model_dump() if hasattr(resp, "model_dump") else None,
        )

    def stream(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> Iterator[str]:
        model = model or DEFAULT_MODEL
        kwargs = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system

        try:
            with self._client.messages.stream(**kwargs) as stream:
                for text in stream.text_stream:
                    yield text
        except Exception as e:
            raise ProviderError(str(e), provider="claude") from e

    def list_models(self) -> list[ModelInfo]:
        return list(MODELS)
