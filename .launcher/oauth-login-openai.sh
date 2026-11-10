#!/usr/bin/env bash
# oauth-login-openai.sh — `jht oauth-login` per il provider openai/codex, DENTRO il container.
# I wrapper (scripts/jht-wrapper.sh e .ps1) sono file singoli sull'host e non crescono: la scelta fra i due
# accessi sta qui. Con `harness` assente o `codex` nel config è il login di sempre (`codex login --device-auth`);
# con `harness: pi` è il login di Pi, che è l'accesso con cui partono gli agenti (<JHT_HOME>/.pi/agent/auth.json):
# un login di Codex non servirebbe a nessun agente.
#
# Pi ha il login solo nella sua TUI (/login), quindi serve un terminale vero: senza, si dice e non si avvia niente.
# Env: JHT_HOME (default /jht_home).

# Gli argomenti di pi per il solo accesso, gli stessi del wizard (cli/wizard/pi-login.js: PI_LOGIN_ARGS): niente
# identità, skill, estensioni o MCP intorno.
JHT_PI_LOGIN_ARGS="-nc -na -ns -ne --no-mcp"

# jht_oauth_login_pi → il login di Pi nel terminale di chi chiama; 0 se alla fine c'è il login del provider del setup (jht_pi_login_check).
jht_oauth_login_pi() {
  if ! { [ -t 0 ] && [ -t 1 ]; }; then
    echo "Error: the sign-in of pi needs a terminal (pi has /login only in its screen). Run in a terminal: jht oauth-login" >&2
    return 1
  fi
  jht_pi_version_check || return 1
  mkdir -p "$(jht_pi_agent_dir)" || return 1
  chmod 700 "$(jht_pi_agent_dir)" 2>/dev/null || true
  echo "Pi opens below. What to do in it:"
  echo "  1. type /login and choose ChatGPT (OpenAI): not Anthropic, the team on Pi runs on OpenAI, and a Claude subscription used from Pi may be billed per token, as Pi itself warns"
  echo "  2. open the URL it shows in your browser and finish the sign-in"
  echo "  3. leave Pi with Ctrl+C (or type /quit): the sign-in is checked here and the setup goes on"
  echo "Behind a company proxy the sign-in can fail with \"This operation was aborted\": run jht oauth-login from a network without it, or give an OpenAI API key instead: jht setup --non-interactive --provider openai --harness pi --auth-method api_key --secret-mode file."
  # shellcheck disable=SC2086  # gli argomenti fissi sono parole separate
  PI_CODING_AGENT_DIR="$(jht_pi_agent_dir)" PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 "$(jht_pi_bin)" $JHT_PI_LOGIN_ARGS || true
  # What counts is the login of the provider of the setup, not a file that is there: jht_pi_login_check says what is wrong.
  if jht_pi_login_check "${JHT_HOME:-/jht_home}/jht.config.json"; then
    echo "Pi login found: ${JHT_PI_LOGIN_FOUND:-the provider of the setup} ($(jht_pi_agent_dir)/auth.json)"
    return 0
  fi
  if jht_pi_login_present; then return 1; fi
  echo "Error: no pi login was saved ($(jht_pi_agent_dir)/auth.json is missing, empty or not yours). Run again: jht oauth-login" >&2
  return 1
}

# jht_oauth_login_openai → il login di Codex o di Pi, secondo `harness` del config.
jht_oauth_login_openai() {
  local home="${JHT_HOME:-/jht_home}" harness
  harness="$(jht_config_harness "$home/jht.config.json")" || return 1
  if [ "$harness" = "pi" ]; then
    jht_oauth_login_pi
    return $?
  fi
  exec codex login --device-auth
}

# Eseguito (non sorgente): parte il login.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  # shellcheck source=/dev/null
  . "$(cd "$(dirname "$0")" && pwd)/spawn-lib.sh"
  jht_oauth_login_openai
  exit $?
fi
