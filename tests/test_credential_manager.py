"""Test per il sistema di gestione credenziali."""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared.skills.credential_planner import (
    create_credential_plan, trim_to_undefined,
    trim_credential_to_undefined, read_provider_env,
)
from shared.skills.credential_manager import (
    save_api_key, resolve_api_key, delete_api_key,
    save_oauth_token, resolve_oauth_token, delete_oauth_token,
    resolve_credential, list_configured_providers,
    SecretRefUnavailableError, is_secret_ref_unavailable_error,
    resolve_credentials_from_values,
)


# --- Planner helpers ---

class TestTrimHelpers:
    def test_trim_stringa_valida(self):
        assert trim_to_undefined("  hello  ") == "hello"

    def test_trim_stringa_vuota(self):
        assert trim_to_undefined("") is None
        assert trim_to_undefined("   ") is None

    def test_trim_non_stringa(self):
        assert trim_to_undefined(None) is None
        assert trim_to_undefined(123) is None

    def test_credential_rifiuta_env_placeholder(self):
        assert trim_credential_to_undefined("${MY_VAR}") is None

    def test_credential_accetta_valore_reale(self):
        assert trim_credential_to_undefined("sk-real-key") == "sk-real-key"


class TestCredentialPlan:
    def test_plan_con_file_value(self):
        plan = create_credential_plan("claude", file_value="file-key")
        assert plan.provider == "claude"
        assert plan.local_key.configured is True
        assert plan.local_key.value == "file-key"
        assert plan.env_var_name == "ANTHROPIC_API_KEY"

    def test_plan_senza_file(self):
        plan = create_credential_plan("openai")
        assert plan.local_key.configured is False
        assert plan.local_key.value is None


# --- API key ---

class TestApiKey:
    def setup_method(self):
        delete_api_key("claude")

    def teardown_method(self):
        delete_api_key("claude")
        os.environ.pop("ANTHROPIC_API_KEY", None)

    def test_save_e_resolve(self):
        save_api_key("claude", "sk-test-123")
        assert resolve_api_key("claude") == "sk-test-123"

    def test_env_ha_precedenza_su_file(self):
        save_api_key("claude", "file-key")
        os.environ["ANTHROPIC_API_KEY"] = "env-key"
        assert resolve_api_key("claude") == "env-key"

    def test_file_first_precedence(self):
        save_api_key("claude", "file-key")
        os.environ["ANTHROPIC_API_KEY"] = "env-key"
        assert resolve_api_key("claude", precedence="file-first") == "file-key"

    def test_delete(self):
        save_api_key("claude", "sk-test")
        assert delete_api_key("claude") is True
        assert resolve_api_key("claude") is None

    def test_provider_invalido(self):
        with pytest.raises(ValueError):
            save_api_key("invalid", "key")

    def test_key_vuota(self):
        with pytest.raises(ValueError):
            save_api_key("claude", "  ")


# --- OAuth ---

class TestOAuth:
    def setup_method(self):
        delete_oauth_token("chatgpt_pro")

    def teardown_method(self):
        delete_oauth_token("chatgpt_pro")

    def test_save_e_resolve(self):
        save_oauth_token("chatgpt_pro", "token-xyz",
                         refresh_token="refresh-abc", expires_at=9999999999.0)
        result = resolve_oauth_token("chatgpt_pro")
        assert result["access_token"] == "token-xyz"
        assert result["refresh_token"] == "refresh-abc"
        assert result["is_expired"] is False

    def test_token_scaduto(self):
        save_oauth_token("chatgpt_pro", "old-token", expires_at=1.0)
        result = resolve_oauth_token("chatgpt_pro")
        assert result["is_expired"] is True

    def test_provider_invalido(self):
        with pytest.raises(ValueError):
            save_oauth_token("invalid", "token")


# --- Interfaccia unificata ---

class TestResolveCredential:
    def setup_method(self):
        delete_api_key("claude")
        delete_oauth_token("chatgpt_pro")

    def teardown_method(self):
        delete_api_key("claude")
        delete_oauth_token("chatgpt_pro")

    def test_api_key(self):
        save_api_key("claude", "sk-unified")
        cred = resolve_credential("claude")
        assert cred["type"] == "api_key"
        assert cred["api_key"] == "sk-unified"

    def test_oauth(self):
        save_oauth_token("chatgpt_pro", "oauth-unified")
        cred = resolve_credential("chatgpt_pro")
        assert cred["type"] == "oauth"
        assert cred["access_token"] == "oauth-unified"

    def test_provider_sconosciuto(self):
        with pytest.raises(ValueError):
            resolve_credential("unknown")


# --- Error handling ---

class TestSecretRefError:
    def test_creazione(self):
        err = SecretRefUnavailableError("claude.api_key")
        assert err.path == "claude.api_key"

    def test_check_corretto(self):
        err = SecretRefUnavailableError("claude.api_key")
        assert is_secret_ref_unavailable_error(err) is True
        assert is_secret_ref_unavailable_error(err, "claude.api_key") is True
        assert is_secret_ref_unavailable_error(err, "other") is False

    def test_check_tipo_sbagliato(self):
        assert is_secret_ref_unavailable_error(ValueError()) is False
