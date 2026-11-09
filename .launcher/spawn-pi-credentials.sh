#!/usr/bin/env bash
# spawn-pi-credentials.sh — prima di accendere un agente su pi: c'è con cosa parlare al provider?
# Caricato da spawn-lib.sh. Senza credenziali pi si accende lo stesso e sbaglia al primo messaggio
# ("No API key found"): qui l'avvio si ferma prima, e dice cosa manca e come rimediare.
# Il controllo guarda se le credenziali CI SONO, mai cosa contengono: del login di pi legge solo
# esistenza, tipo, proprietario e se il file è vuoto (lstat), del config solo se c'è una chiave.

# jht_pi_login_present → 0 se <JHT_HOME>/.pi/agent/auth.json c'è ed è credibile: un file regolare (non un
#   link, non una cartella), non vuoto, di chi esegue o di root. Il file di un altro utente non vale: pi lo
#   leggerebbe come suo login. Il contenuto non si apre.
jht_pi_login_present() {
  python3 - "$(jht_pi_agent_dir)/auth.json" <<'PYEOF'
import os, stat, sys
try:
    info = os.lstat(sys.argv[1])
except OSError:
    raise SystemExit(1)
ok = stat.S_ISREG(info.st_mode) and info.st_size > 0 and info.st_uid in (os.geteuid(), 0)
raise SystemExit(0 if ok else 1)
PYEOF
}

# jht_pi_config_key_present <jht.config.json> → 0 se il provider attivo del config è in modalità api_key
#   e ha una chiave scritta o un riferimento a una chiave in un file o in una variabile (api_key_ref: la chiave la
#   controlla jht_key_wrap prima del pane). La chiave non viene stampata.
jht_pi_config_key_present() {
  [ -f "${1:-}" ] || return 1
  python3 - "$1" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        cfg = json.load(handle)
    provider = (cfg.get("providers") or {}).get(cfg.get("active_provider") or "") or {}
    ref = provider.get("api_key_ref")
    has_ref = isinstance(ref, dict) and ref.get("type") == "ref" and (
        (ref.get("source") == "file" and bool(ref.get("path"))) or (ref.get("source") == "env" and bool(ref.get("id"))))
    ok = provider.get("auth_method") == "api_key" and (bool(str(provider.get("api_key") or "").strip()) or has_ref)
except Exception:
    ok = False
raise SystemExit(0 if ok else 1)
PYEOF
}

# jht_pi_credentials_check <jht.config.json>
#   0 se c'è una chiave (JHT_API_KEY_FILE, o api_key / api_key_ref del provider attivo nel config) o un login di
#   pi. Altrimenti rc 1, con su stderr cosa manca e come si rimedia; non scrive niente e non avvia niente.
jht_pi_credentials_check() {
  [ -z "${JHT_API_KEY_FILE:-}" ] || return 0   # il file lo controlla jht_key_wrap, prima del pane
  jht_pi_config_key_present "${1:-}" && return 0
  jht_pi_login_present && return 0
  cat >&2 <<EOF
Error: the pi harness has no credentials, so pi would start and fail at its first message ("No API key found").
  Missing: an API key (JHT_API_KEY_FILE, or the api key of the active provider in the configuration)
           and a pi login ($(jht_pi_agent_dir)/auth.json).
  Fix:     sign in to pi: jht setup (keep the configuration, then sign in to pi when it asks);
           or give a key: jht setup with the API key, or JHT_API_KEY_FILE=<file on tmpfs>.
           See what is configured with: jht providers list.
  Or go back to the default harness: jht providers harness codex.
EOF
  return 1
}
