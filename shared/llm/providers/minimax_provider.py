"""Provider Minimax — wrapper API REST (OpenAI-compatible).

Minimax espone un'API compatibile con il formato OpenAI chat completions.
Modelli: abab6.5-chat, abab5.5-chat.
Richiede: pip install requests
"""

import os
from typing import Iterator, Optional

import requests

from shared.llm.base import CompletionResponse, LLMProvider, ModelInfo, ProviderError

MINIMAX_BASE_URL = "https://api.minimax.chat/v1"

MODELS = [
    ModelInfo(
        id="abab6.5-chat",
        name="Minimax ABAB 6.5",
        provider="minimax",
        context_window=245_760,
        max_output_tokens=16_384,
        supports_vision=False,
        supports_tools=True,
    ),
    ModelInfo(
        id="abab5.5-chat",
        name="Minimax ABAB 5.5",
        provider="minimax",
        context_window=16_384,
        max_output_tokens=4_096,
        supports_vision=False,
        supports_tools=False,
    ),
]

DEFAULT_MODEL = "abab6.5-chat"


def _resolve_key() -> str:
    """Risolve API key: credential_manager (Gus) -> env var fallback."""
    try:
        from shared.skills.credential_manager import resolve_api_key
        key = resolve_api_key("minimax")
        if key:
            return key
    except ImportError:
        pass
    key = os.environ.get("MINIMAX_API_KEY", "").strip()
    if not key:
        raise ProviderError(
            "MINIMAX_API_KEY non configurata. "
            "Imposta la variabile d'ambiente o usa credential_manager.",
            provider="minimax",
        )
    return key


class MinimaxProvider(LLMProvider):
    """Provider per Minimax via API REST OpenAI-compatible."""

    provider_id = "minimax"

    def __init__(self):
        self._api_key = _resolve_key()
        self._base_url = os.environ.get("MINIMAX_BASE_URL", MINIMAX_BASE_URL).rstrip("/")

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

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

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        try:
            resp = requests.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            raise ProviderError(str(e), provider="minimax") from e

        if "error" in data:
            raise ProviderError(
                data["error"].get("message", str(data["error"])),
                provider="minimax",
            )

        choice = data["choices"][0]
        usage_data = data.get("usage", {})

        return CompletionResponse(
            content=choice["message"]["content"],
            model=data.get("model", model),
            provider="minimax",
            usage={
                "input_tokens": usage_data.get("prompt_tokens", 0),
                "output_tokens": usage_data.get("completion_tokens", 0),
            },
            finish_reason=choice.get("finish_reason", ""),
            raw=data,
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
        import json as _json

        model = model or DEFAULT_MODEL
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        try:
            resp = requests.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
                timeout=120,
                stream=True,
            )
            resp.raise_for_status()

            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break
                chunk = _json.loads(data_str)
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                text = delta.get("content")
                if text:
                    yield text
        except requests.RequestException as e:
            raise ProviderError(str(e), provider="minimax") from e

    def list_models(self) -> list[ModelInfo]:
        return list(MODELS)
