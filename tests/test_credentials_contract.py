"""Keep the CLI secret store and the documented keyring contract aligned."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_secret_store_prefers_the_keyring_canonical_environment_variable():
    source = (ROOT / "cli/src/commands/secrets.js").read_text(encoding="utf-8")
    assert "const KEY_ENV = 'JHT_CREDENTIALS_KEY'" in source
    assert "const LEGACY_KEY_ENV = 'JHT_SECRET_KEY'" in source
    assert "process.env[KEY_ENV] ?? process.env[LEGACY_KEY_ENV]" in source


def test_packaged_desktop_cli_does_not_restore_plaintext_secret_fallback():
    source = (
        ROOT / "desktop/app-payload/cli/src/commands/secrets.js"
    ).read_text(encoding="utf-8")
    assert "const KEY_ENV = 'JHT_CREDENTIALS_KEY'" in source
    assert "AES-256-GCM" in source
    assert "salvato (plaintext)" not in source
    assert "mode: 0o600" in source
