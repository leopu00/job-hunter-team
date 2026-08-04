"""Factory per istanziare i provider LLM.

Legge il provider di default da JHT_LLM_PROVIDER (env) o jht.config.json.
"""

import json
import os
from typing import Optional

from shared.llm.base import LLMProvider, ProviderError

# Alias normalizzati per i provider ID
PROVIDER_ALIASES = {
    "claude": "claude",
    "anthropic": "claude",
    "sonnet": "claude",
    "opus": "claude",
    "haiku": "claude",
    "openai": "openai",
    "gpt": "openai",
    "gpt4": "openai",
    "chatgpt": "openai",
    "minimax": "minimax",
    "abab": "minimax",
}

PROVIDER_REGISTRY = {
    "claude": "shared.llm.providers.anthropic_provider.AnthropicProvider",
    "openai": "shared.llm.providers.openai_provider.OpenAIProvider",
    "minimax": "shared.llm.providers.minimax_provider.MinimaxProvider",
}


def normalize_provider_id(raw: str) -> str:
    """Normalizza un provider ID con alias. Raise se sconosciuto."""
    normalized = PROVIDER_ALIASES.get(raw.lower().strip())
    if not normalized:
        validi = sorted(set(PROVIDER_ALIASES.values()))
        raise ProviderError(
            f"Provider sconosciuto: {raw!r}. Validi: {validi}",
        )
    return normalized


def _import_provider_class(dotted_path: str) -> type:
    """Importa dinamicamente una classe provider dal path puntato."""
    module_path, class_name = dotted_path.rsplit(".", 1)
    import importlib
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


def _read_config_provider() -> Optional[str]:
    """Legge il provider da jht.config.json (campo active_provider)."""
    config_paths = [
        os.path.join(os.getcwd(), "jht.config.json"),
        os.path.join(os.path.dirname(__file__), "..", "..", "jht.config.json"),
        os.path.join(os.path.dirname(__file__), "..", "config", "jht.config.json"),
    ]
    for path in config_paths:
        if os.path.isfile(path):
            try:
                with open(path) as f:
                    config = json.load(f)
                return config.get("active_provider")
            except (json.JSONDecodeError, OSError):
                continue
    return None


def get_provider(name: Optional[str] = None) -> LLMProvider:
    """Istanzia un provider LLM per nome.

    Args:
        name: nome del provider (claude, openai, minimax) o alias.
              Se None, usa get_default_provider().

    Returns:
        Istanza del provider pronta all'uso.
    """
    if name is None:
        return get_default_provider()

    provider_id = normalize_provider_id(name)
    dotted_path = PROVIDER_REGISTRY[provider_id]
    cls = _import_provider_class(dotted_path)
    return cls()


def get_default_provider() -> LLMProvider:
    """Restituisce il provider di default.

    Precedenza: JHT_LLM_PROVIDER env -> jht.config.json -> claude (fallback).
    """
    # 1. Variabile d'ambiente
    env_provider = os.environ.get("JHT_LLM_PROVIDER", "").strip()
    if env_provider:
        return get_provider(env_provider)

    # 2. Config file
    config_provider = _read_config_provider()
    if config_provider:
        return get_provider(config_provider)

    # 3. Fallback: Claude
    return get_provider("claude")


def list_available_providers() -> list[dict]:
    """Elenca i provider registrati con stato di disponibilita'.

    Returns:
        Lista di dict con provider_id, available (bool), error (str se non disponibile).
    """
    result = []
    for provider_id in sorted(PROVIDER_REGISTRY.keys()):
        entry = {"provider_id": provider_id, "available": False, "error": ""}
        try:
            provider = get_provider(provider_id)
            entry["available"] = True
            entry["models"] = [m.id for m in provider.list_models()]
        except ProviderError as e:
            entry["error"] = str(e)
        except Exception as e:
            entry["error"] = str(e)
        result.append(entry)
    return result
