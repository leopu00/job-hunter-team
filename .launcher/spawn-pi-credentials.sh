#!/usr/bin/env bash
# spawn-pi-credentials.sh — prima di accendere un agente su pi: c'è con cosa parlare al provider?
# Caricato da spawn-lib.sh. Senza credenziali pi si accende lo stesso e sbaglia al primo messaggio
# ("No API key found"): qui l'avvio si ferma prima, e dice cosa manca e come rimediare.
# Il controllo guarda se le credenziali CI SONO, mai i valori: del login di pi legge esistenza, tipo, proprietario e se il file è
# vuoto (lstat) e poi i NOMI delle voci (per quale provider è il login, shared/skills/pi_login.py), del config solo se c'è una chiave.

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

# jht_pi_active_provider <jht.config.json> → il provider attivo del config (minuscolo), o niente.
jht_pi_active_provider() {
  [ -f "${1:-}" ] || return 0
  python3 - "$1" <<'PYEOF2'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        value = json.load(handle).get("active_provider") or ""
    print(str(value).strip().lower() if isinstance(value, str) else "")
except Exception:
    pass
PYEOF2
}

# jht_pi_login_check <jht.config.json> → 0 se il login di pi vale per il provider del setup; altrimenti rc 1 e su stderr perché.
#   Un file di login che c'è non dice di quale account è: pi tiene una voce per servizio (il login ChatGPT è `openai`, quello di
#   Anthropic `anthropic`), e un auth.json con la sola voce di Anthropic (abbonamento Claude, a token come «extra usage» quando lo
#   usa pi) è stato preso per il login dell'account OpenAI. Si leggono i NOMI delle voci (shared/skills/pi_login.py), mai i valori.
jht_pi_login_check() {
  local config="${1:-}" provider script out state found
  JHT_PI_LOGIN_FOUND=""
  jht_pi_login_present || return 1
  provider="$(jht_pi_active_provider "$config" | tr -cd 'a-z0-9._-' | cut -c1-40)"   # the name goes into a message: plain lowercase words only
  for script in "${JHT_SPAWN_LIB_DIR:-}/../shared/skills/pi_login.py" /app/shared/skills/pi_login.py; do [ -f "$script" ] && break; script=""; done
  [ -n "$script" ] || return 0   # senza il controllo (immagine vecchia) vale la presenza, come prima
  out="$(python3 -I "$script" "$(jht_pi_agent_dir)/auth.json" "$provider" 2>/dev/null)" || out=""
  state="$(printf '%s' "$out" | sed -n 's/.*"state":"\([a-z_]*\)".*/\1/p')"
  found="$(printf '%s' "$out" | sed -n 's/.*"found":\[\([^]]*\)\].*/\1/p' | tr -d '"')"
  JHT_PI_LOGIN_FOUND="$found"
  case "$state" in
    ok|no_rule|"") return 0 ;;
  esac
  {
    echo "Error: the pi login ($(jht_pi_agent_dir)/auth.json) is not a login for the provider of the setup (${provider:-none})."
    if [ "$state" = unreadable ]; then
      echo "  The file is not readable as the login of pi."
    else
      echo "  It holds the sign-in of: ${found:-nothing}."
    fi
    case ",$found," in
      *,anthropic,*) echo "  Pi itself warns that a Claude subscription used from pi may be billed per token, as extra usage: with Claude, use the claude program (choose Claude in jht setup)." ;;
    esac
    echo "  Fix:     sign in to pi with the provider of the setup: jht oauth-login (in pi type /login, choose the provider, then leave with Ctrl+C or /quit),"
    echo "           or jht setup. This login is not used: nothing starts on it."
  } >&2
  return 1
}

# jht_pi_credentials_check <jht.config.json>
#   0 se c'è una chiave (JHT_API_KEY_FILE, o api_key / api_key_ref del provider attivo nel config) o un login di
#   pi. Altrimenti rc 1, con su stderr cosa manca e come si rimedia; non scrive niente e non avvia niente.
jht_pi_credentials_check() {
  [ -z "${JHT_API_KEY_FILE:-}" ] || return 0   # il file lo controlla jht_key_wrap, prima del pane
  jht_pi_config_key_present "${1:-}" && return 0
  if jht_pi_login_present; then
    jht_pi_login_check "${1:-}"
    return $?
  fi
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
