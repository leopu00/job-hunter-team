"""Provider OpenAI — wrapper SDK openai.

Modelli supportati: gpt-4o, gpt-4o-mini, o3-mini.
Richiede: pip install openai
"""

import os
from typing import Iterator, Optional

from shared.llm.base import CompletionResponse, LLMProvider, ModelInfo, ProviderError

try:
    import openai
except ImportError:
    openai = None  # type: ignore[assignment]

MODELS = [
    ModelInfo(
        id="gpt-4o",
        name="GPT-4o",
        provider="openai",
        context_window=128_000,
        max_output_tokens=16_384,
        supports_vision=True,
        supports_tools=True,
    ),
    ModelInfo(
        id="gpt-4o-mini",
        name="GPT-4o Mini",
        provider="openai",
        context_window=128_000,
        max_output_tokens=16_384,
        supports_vision=True,
        supports_tools=True,
    ),
    ModelInfo(
        id="o3-mini",
        name="o3-mini",
        provider="openai",
        context_window=200_000,
        max_output_tokens=100_000,
        supports_vision=False,
        supports_tools=True,
    ),
]

DEFAULT_MODEL = "gpt-4o"


def _resolve_key() -> str:
    """Risolve API key: credential_manager (Gus) -> env var fallback."""
    try:
        from shared.skills.credential_manager import resolve_api_key
        key = resolve_api_key("openai")
        if key:
            return key
    except ImportError:
        pass
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise ProviderError(
            "OPENAI_API_KEY non configurata. "
            "Imposta la variabile d'ambiente o usa credential_manager.",
            provider="openai",
        )
    return key


class OpenAIProvider(LLMProvider):
    """Provider per GPT via OpenAI API."""

    provider_id = "openai"

    def __init__(self):
        if openai is None:
            raise ProviderError(
                "SDK openai non installato. Esegui: pip install openai",
                provider="openai",
            )
        api_key = _resolve_key()
        self._client = openai.OpenAI(api_key=api_key)

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
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        try:
            resp = self._client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as e:
            raise ProviderError(str(e), provider="openai") from e

        choice = resp.choices[0]
        usage = {}
        if resp.usage:
            usage = {
                "input_tokens": resp.usage.prompt_tokens,
                "output_tokens": resp.usage.completion_tokens,
            }

        return CompletionResponse(
            content=choice.message.content or "",
            model=resp.model,
            provider="openai",
            usage=usage,
            finish_reason=choice.finish_reason or "",
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
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        try:
            stream = self._client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:
            raise ProviderError(str(e), provider="openai") from e

    def list_models(self) -> list[ModelInfo]:
        return list(MODELS)
