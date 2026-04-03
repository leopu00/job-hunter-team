"""Piano credenziali — tipi, helper e creazione del piano di risoluzione.

Definisce le strutture dati per la risoluzione credenziali multi-provider
con supporto env var e file locale.
"""

import os
import re
from dataclasses import dataclass, field
from typing import Optional

CredentialInputPath = str  # es. "claude.api_key", "openai.api_key"

ENV_VAR_MAP = {
    "claude": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "minimax": "MINIMAX_API_KEY",
}

CredentialPrecedence = str  # "env-first" | "file-first"


@dataclass
class ConfiguredCredentialInput:
    """Input credenziale configurato con tracking sorgente."""
    path: str
    configured: bool = False
    value: Optional[str] = None
    ref_path: Optional[str] = None
    has_secret_ref: bool = False


@dataclass
class CredentialPlan:
    """Piano di risoluzione credenziali per un provider LLM."""
    provider: str
    configured_mode: str = "local"  # "local" | "remote" (env | file)
    env_key: Optional[str] = None
    local_key: ConfiguredCredentialInput = field(
        default_factory=lambda: ConfiguredCredentialInput(path=""))
    env_var_name: Optional[str] = None
    token_can_win: bool = True
    file_configured: bool = False


def trim_to_undefined(value) -> Optional[str]:
    """Restituisce stringa trimmata o None se vuota/non-stringa."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def _contains_env_var_reference(value: str) -> bool:
    """Rileva placeholder env non risolti (es. ${MY_VAR})."""
    return bool(re.search(r'\$\{[A-Z_][A-Z0-9_]*\}', value))


def trim_credential_to_undefined(value) -> Optional[str]:
    """Come trim_to_undefined, ma rifiuta placeholder env non risolti."""
    trimmed = trim_to_undefined(value)
    if trimmed and _contains_env_var_reference(trimmed):
        return None
    return trimmed


def read_provider_env(provider: str, env: Optional[dict] = None) -> Optional[str]:
    """Legge la env var corrispondente al provider."""
    env = env if env is not None else os.environ
    env_var = ENV_VAR_MAP.get(provider)
    if not env_var:
        return None
    return trim_to_undefined(env.get(env_var))


def has_provider_env_candidate(provider: str, env: Optional[dict] = None) -> bool:
    """True se il provider ha una env var configurata."""
    return read_provider_env(provider, env) is not None


def create_credential_plan(provider: str, file_value: Optional[str] = None,
                           env: Optional[dict] = None) -> CredentialPlan:
    """Crea un piano di risoluzione credenziali per il provider."""
    env = env if env is not None else os.environ
    env_key = read_provider_env(provider, env)
    path = f"{provider}.api_key"

    local_key = ConfiguredCredentialInput(
        path=path,
        configured=file_value is not None,
        value=trim_credential_to_undefined(file_value),
    )

    return CredentialPlan(
        provider=provider,
        configured_mode="local",
        env_key=env_key,
        local_key=local_key,
        env_var_name=ENV_VAR_MAP.get(provider),
        token_can_win=True,
        file_configured=local_key.configured,
    )
