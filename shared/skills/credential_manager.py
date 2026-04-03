"""Gestione credenziali API key e subscription OAuth.
Credenziali in ~/.jht/credentials/ (fuori da git).
"""

import json
import os
import time
from pathlib import Path
from typing import Optional

from .credential_planner import (
    ENV_VAR_MAP,
    CredentialPlan,
    create_credential_plan,
    read_provider_env,
    trim_credential_to_undefined,
    trim_to_undefined,
)

CREDENTIALS_DIR = Path.home() / ".jht" / "credentials"
OAUTH_PROVIDERS = {"chatgpt_pro", "claude_max"}
VALID_PROVIDERS = set(ENV_VAR_MAP.keys()) | OAUTH_PROVIDERS

class SecretRefUnavailableError(Exception):
    """Errore quando un secret reference non è risolvibile."""
    def __init__(self, path: str):
        self.path = path
        super().__init__(
            f"{path} è configurato come secret reference ma non è disponibile. "
            f"Fix: imposta la variabile d'ambiente corrispondente o passa la key esplicitamente."
        )


def is_secret_ref_unavailable_error(error, expected_path: Optional[str] = None) -> bool:
    """Verifica se l'errore è un SecretRefUnavailableError."""
    if not isinstance(error, SecretRefUnavailableError):
        return False
    if expected_path is None:
        return True
    return error.path == expected_path


def _first_defined(*values) -> Optional[str]:
    for v in values:
        if v: return v
    return None

def _ensure_dir() -> Path:
    CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)
    return CREDENTIALS_DIR


def _credential_path(provider: str) -> Path:
    return _ensure_dir() / f"{provider}.json"


def _read_credential_file(provider: str) -> Optional[dict]:
    path = _credential_path(provider)
    if not path.exists():
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _write_credential_file(provider: str, data: dict) -> None:
    path = _credential_path(provider)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(path, 0o600)


def resolve_credentials_from_values(provider: str, file_key: Optional[str] = None,
                                    env: Optional[dict] = None,
                                    precedence: str = "env-first") -> Optional[str]:
    """Risolve credenziale con catena di precedenza env/file."""
    env = env if env is not None else os.environ
    env_key = read_provider_env(provider, env)
    config_key = trim_credential_to_undefined(file_key)

    if precedence == "file-first":
        return _first_defined(config_key, env_key)
    return _first_defined(env_key, config_key)


def _resolve_local_credentials(plan: CredentialPlan,
                                precedence: str = "env-first") -> Optional[str]:
    """Risolve credenziali locali usando il piano."""
    file_key = plan.local_key.value
    return resolve_credentials_from_values(
        plan.provider, file_key=file_key, precedence=precedence
    )


def save_api_key(provider: str, api_key: str) -> None:
    if provider not in ENV_VAR_MAP:
        raise ValueError(f"Provider non supportato: {provider}. "
                         f"Validi: {sorted(ENV_VAR_MAP.keys())}")
    api_key = api_key.strip()
    if not api_key:
        raise ValueError("API key vuota")
    _write_credential_file(provider, {
        "type": "api_key", "provider": provider,
        "api_key": api_key, "saved_at": time.time(),
    })


def resolve_api_key(provider: str, precedence: str = "env-first") -> Optional[str]:
    """Risolve API key usando il credential plan con precedenza configurabile."""
    if provider not in ENV_VAR_MAP:
        raise ValueError(f"Provider non supportato: {provider}")
    file_data = _read_credential_file(provider)
    file_key = file_data.get("api_key") if file_data else None
    plan = create_credential_plan(provider, file_value=file_key)
    return _resolve_local_credentials(plan, precedence)


def delete_api_key(provider: str) -> bool:
    path = _credential_path(provider)
    if path.exists():
        path.unlink()
        return True
    return False


def save_oauth_token(provider: str, access_token: str,
                     refresh_token: Optional[str] = None,
                     expires_at: Optional[float] = None) -> None:
    if provider not in OAUTH_PROVIDERS:
        raise ValueError(f"Provider OAuth non supportato: {provider}. "
                         f"Validi: {sorted(OAUTH_PROVIDERS)}")
    access_token = access_token.strip()
    if not access_token:
        raise ValueError("Access token vuoto")
    _write_credential_file(provider, {
        "type": "oauth", "provider": provider,
        "access_token": access_token, "refresh_token": refresh_token,
        "expires_at": expires_at, "saved_at": time.time(),
    })


def resolve_oauth_token(provider: str) -> Optional[dict]:
    """Risolve token OAuth con tracking scadenza."""
    if provider not in OAUTH_PROVIDERS:
        raise ValueError(f"Provider OAuth non supportato: {provider}")
    data = _read_credential_file(provider)
    if not data or data.get("type") != "oauth":
        return None
    access_token = trim_to_undefined(data.get("access_token"))
    if not access_token:
        return None
    expires_at = data.get("expires_at")
    is_expired = expires_at is not None and time.time() > expires_at
    return {
        "access_token": access_token, "refresh_token": data.get("refresh_token"),
        "expires_at": expires_at, "is_expired": is_expired,
    }


def delete_oauth_token(provider: str) -> bool:
    return delete_api_key(provider)


def resolve_credential(provider: str) -> Optional[dict]:
    """Risolve credenziale per qualsiasi provider (API key o OAuth)."""
    if provider in ENV_VAR_MAP:
        key = resolve_api_key(provider)
        if key:
            return {"type": "api_key", "provider": provider, "api_key": key}
        return None
    if provider in OAUTH_PROVIDERS:
        token_data = resolve_oauth_token(provider)
        if token_data:
            return {"type": "oauth", "provider": provider, **token_data}
        return None
    raise ValueError(f"Provider sconosciuto: {provider}. Validi: {sorted(VALID_PROVIDERS)}")


def list_configured_providers() -> list[dict]:
    """Elenca tutti i provider con credenziali configurate."""
    configured = []
    for provider in sorted(ENV_VAR_MAP.keys()):
        env_key = read_provider_env(provider)
        file_data = _read_credential_file(provider)
        if env_key:
            configured.append({"provider": provider, "type": "api_key", "source": "env"})
        elif file_data and file_data.get("type") == "api_key":
            configured.append({"provider": provider, "type": "api_key", "source": "file"})
    for provider in sorted(OAUTH_PROVIDERS):
        file_data = _read_credential_file(provider)
        if file_data and file_data.get("type") == "oauth":
            expires_at = file_data.get("expires_at")
            is_expired = expires_at is not None and time.time() > expires_at
            configured.append({
                "provider": provider, "type": "oauth",
                "source": "file", "is_expired": is_expired,
            })
    return configured
