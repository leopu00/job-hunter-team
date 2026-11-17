#!/usr/bin/env bash
# spawn-harness.sh — quale CLI guida un agente: harness del config (codex | pi).
# Caricato da spawn-lib.sh (che tiene il catalogo JHT_AGENT_HARNESSES, jht_agent_harness, i controlli e gli
# argomenti di pi): qui stanno la lettura del config e i pezzi per i servizi che non passano da
# start-agent.sh (Dottore, Mantenitore). Le funzioni si risolvono alla chiamata: l'ordine di caricamento
# fra i due file non conta.

# Gli harness che il config e la variabile conoscono (shared/runtime/agent-harness.js).
JHT_AGENT_HARNESSES="codex pi"

# jht_agent_harness <ruolo> [harness-del-config]
#   Stampa "pi" se il ruolo deve girare su pi, niente per la CLI del provider.
#   Vince JHT_AGENT_HARNESS_<RUOLO>, poi l'harness del config, poi `codex`.
#   rc 2 (col perché su stderr) se uno dei due chiede qualcosa che non c'è:
#   un errore di configurazione ferma l'avvio, non ricade in silenzio
#   sull'harness di oggi.
jht_agent_harness() {
  local role var value="" source_name
  role="$(printf '%s' "${1:-}" | tr 'a-z' 'A-Z')"
  case "$role" in
    ""|*[!A-Z0-9_]*) return 0 ;;
  esac
  var="JHT_AGENT_HARNESS_${role}"
  value="${!var:-}"
  source_name="$var"
  if [ -z "$value" ]; then
    value="${2:-}"
    source_name="harness in the config"
  fi
  case "$value" in
    ""|codex) return 0 ;;
    pi) ;;
    *)
      echo "Error: $source_name='$value' is not a known agent harness (${JHT_AGENT_HARNESSES// /, }; leave it unset for the default)." >&2
      return 2
      ;;
  esac
  printf 'pi\n'
}

# Il pi dell'immagine sta in /opt/jht-pi, di root: gli agenti lo eseguono e non lo cambiano. Il PATH degli agenti
# ha davanti /opt/jht-deps/bin, che gli agenti possono scrivere: un pi lasciato lì (da un agente o da un'immagine
# vecchia) oscurerebbe quello di root. Per questo pi si lancia, e se ne controlla la versione, per percorso
# assoluto quando c'è; senza (immagine vecchia) resta il nome nudo e vale il controllo della versione.
JHT_PI_IMAGE_BIN="/opt/jht-pi/bin/pi"

# jht_pi_bin → il pi da eseguire: quello di root se c'è, altrimenti "pi".
jht_pi_bin() {
  if [ -x "$JHT_PI_IMAGE_BIN" ]; then printf '%s\n' "$JHT_PI_IMAGE_BIN"; else printf 'pi\n'; fi
}

# jht_cli_exec <cli> → cosa scrivere nel pane per lanciare quella CLI (pi per percorso assoluto, le altre per nome).
jht_cli_exec() {
  if [ "${1:-}" = "pi" ]; then jht_pi_bin; else printf '%s\n' "${1:-}"; fi
}

# jht_role_harness <ruolo> <jht.config.json>
#   Come jht_agent_harness, con l'harness letto dal config (jht_config_harness). rc 2 col perché su stderr.
jht_role_harness() {
  local cfg_harness
  cfg_harness="$(jht_config_harness "${2:-}")" || return 2
  jht_agent_harness "${1:-}" "$cfg_harness"
}

# La ricerca web di pi è un'estensione nostra (shared/runtime/pi-harness), per i ruoli che con Codex hanno
# --search (JHT_CODEX_WEB_SEARCH_ROLES). Percorso fisso, non da ambiente: è codice che pi carica.
JHT_PI_WEB_SEARCH_EXT="/app/shared/runtime/pi-harness/web-search.js"

# The spending gate (shared/runtime/pi-harness/spend-gate.js): while the spending brake holds the team, no new turn and
# no new model call start. Every role but the Assistente, which answers the person while the team waits. Fixed path, not
# from the environment: it is code pi loads.
JHT_PI_SPEND_GATE_EXT="/app/shared/runtime/pi-harness/spend-gate.js"

# jht_pi_extension_args <ruolo>
#   Gli argomenti di pi in più per quel ruolo: l'estensione di ricerca (-e esplicito: vale con -ne), solo per i
#   ruoli con la ricerca web su Codex, e il cancello della spesa per ogni ruolo tranne l'Assistente. Se un file
#   manca lo dice e il ruolo parte senza, invece di far fallire pi all'avvio. Si accoda a jht_pi_args.
jht_pi_extension_args() {
  local role="${1:-}"
  [ -n "$role" ] || return 0
  if [ "$role" != assistente ]; then
    if [ -f "$JHT_PI_SPEND_GATE_EXT" ]; then
      printf '%s' " -e '$JHT_PI_SPEND_GATE_EXT'"
    else
      echo "Warning: $JHT_PI_SPEND_GATE_EXT is missing: the $role starts on pi without the spending gate." >&2
    fi
  fi
  jht_codex_web_search_role "$role" || return 0
  if [ -f "$JHT_PI_WEB_SEARCH_EXT" ]; then
    printf '%s' " -e '$JHT_PI_WEB_SEARCH_EXT'"
  else
    echo "Warning: $JHT_PI_WEB_SEARCH_EXT is missing: the $role starts on pi without web search." >&2
  fi
}

# jht_config_harness <jht.config.json>
#   Stampa l'harness scritto nel config (`harness`), niente se non c'è.
#   rc 2 (col perché su stderr) se c'è un valore che non è un harness: un
#   refuso non deve ricadere in silenzio su un altro harness. Un config che
#   manca o non si legge dà niente: lo rifiuta già la scelta del provider.
jht_config_harness() {
  local cfg="${1:-}"
  { [ -f "$cfg" ] && command -v python3 >/dev/null 2>&1; } || return 0
  python3 - "$cfg" "$JHT_AGENT_HARNESSES" <<'PYEOF'
import json, sys
path, known = sys.argv[1], sys.argv[2].split()
try:
    with open(path, encoding="utf-8") as handle:
        cfg = json.load(handle)
except (OSError, ValueError):
    raise SystemExit(0)
value = cfg.get("harness") if isinstance(cfg, dict) else None
if value is None:
    raise SystemExit(0)
if not isinstance(value, str) or value not in known:
    print(f"Error: harness {value!r} in '{path}' is not a known agent harness ({', '.join(known)}); fix it with: jht providers harness pi", file=sys.stderr)
    raise SystemExit(2)
print(value)
PYEOF
}

# jht_spawn_pi_role_pin <ruolo>
#   La classe (sol|terra|luna) che `team.role_models.<ruolo>.model` del config fissa per il ruolo, o niente. Come start-agent.sh,
#   ma senza fermare lo spawn per un valore fuori elenco: qui vale solo una classe che esiste.
jht_spawn_pi_role_pin() {
  local cfg="${JHT_HOME:-/jht_home}/jht.config.json"
  [ -f "$cfg" ] || return 0
  python3 - "$cfg" "${1:-}" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        cfg = json.load(handle)
    entry = (((cfg.get("team") or {}).get("role_models") or {}).get(sys.argv[2]))
    value = entry.get("model") if isinstance(entry, dict) else None
    if value in ("sol", "terra", "luna"):
        print(value)
except Exception:
    pass
PYEOF
}

# jht_spawn_pi_key_env <provider>
#   La chiave API scritta nel config, come variabile d'ambiente del comando di pi: la stessa che start-agent.sh mette davanti
#   al comando di ogni agente (ANTHROPIC_API_KEY, OPENAI_API_KEY, MOONSHOT_API_KEY; GLM non ha un prefisso). Niente se la chiave non
#   e' scritta nel config (un riferimento a un file o a una variabile lo mette jht_key_wrap) o se il metodo non e' la chiave.
#   rc 1 se la chiave ha caratteri che non vanno dentro un comando digitato nel pane.
jht_spawn_pi_key_env() {
  local cfg="${JHT_HOME:-/jht_home}/jht.config.json" out
  [ -z "${JHT_API_KEY_FILE:-}" ] || return 0
  [ -f "$cfg" ] || return 0
  out="$(python3 - "$cfg" "${1:-}" <<'PYEOF'
import json, re, sys
names = {"claude": "ANTHROPIC_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "codex": "OPENAI_API_KEY",
         "kimi": "MOONSHOT_API_KEY", "moonshot": "MOONSHOT_API_KEY"}
name = names.get(sys.argv[2])
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        cfg = json.load(handle)
    prov = (cfg.get("providers") or {}).get(cfg.get("active_provider") or "") or {}
except Exception:
    raise SystemExit(0)
if not name or prov.get("auth_method") != "api_key" or prov.get("api_key_ref"):
    raise SystemExit(0)
key = str(prov.get("api_key") or "").strip()
if not key:
    raise SystemExit(0)
if not re.fullmatch(r"[A-Za-z0-9_.:+=/-]{1,400}", key):
    raise SystemExit(3)
print("%s='%s' " % (name, key))
PYEOF
)"
  case $? in
    0) printf '%s' "$out" ;;
    *) echo "Error: the API key in the configuration has characters that cannot be typed into a pane: use jht setup --secret-mode file|env." >&2; return 1 ;;
  esac
}

# jht_spawn_pi_repl_cmd <workdir> [modello] [ruolo]
#   Il comando di pi per i servizi che non passano da start-agent.sh (Dottore,
#   Mantenitore), con gli stessi argomenti di un ruolo del team: il provider e il modello sono quelli
#   della configurazione attiva, come per ogni altro agente (provider di pi, classe del modello, chiave).
#   Il modello e' quello dato (il modello di riserva di un tentativo dopo un errore di capacita') o, senza, quello
#   della classe del ruolo: il pin di `team.role_models.<ruolo>.model`, altrimenti sol (terra su Claude, come la CLI
#   di Claude, che per questi servizi usa Sonnet). Ferma lo spawn
#   (rc 2, perché su stderr) se manca il provider attivo, l'identità o le skill nella workdir,
#   il pi del pin o le settings leggibili.
#   Con il ruolo (dottore, mantenitore) parte anche con le estensioni che start-agent.sh dà a quel ruolo
#   (jht_pi_extension_args: il cancello della spesa) e con l'ambiente che il cancello legge: senza, un Dottore o un
#   Mantenitore al lavoro spendeva fuori dal freno del budget. JHT_HOME e JHT_AGENT_NAME vanno nel comando perché la
#   shell di una sessione nata dallo spawner non li esporta: senza JHT_HOME il cancello non vede il flag e non ferma niente.
jht_spawn_pi_repl_cmd() {
  local workdir="${1:-}" model="${2:-}" role="${3:-}" role_env="" provider api class key_env key_wrap
  local cfg="${JHT_HOME:-/jht_home}/jht.config.json"
  if [ ! -s "$workdir/AGENTS.md" ] || [ ! -d "$workdir/.agents/skills" ]; then
    echo "[spawn-lib] ERROR: pi needs $workdir/AGENTS.md and $workdir/.agents/skills before it starts; one is missing." >&2
    return 2
  fi
  jht_pi_version_check || return 2
  jht_pi_credentials_check "$cfg" || return 2
  jht_pi_settings "$(jht_pi_agent_dir)/settings.json" || return 2
  # shellcheck source=/dev/null
  . "$JHT_SPAWN_LIB_DIR/role-models.sh"
  provider="$(jht_spawn_active_provider)" || return 2
  if [ -z "$model" ]; then
    class="$(jht_spawn_pi_role_pin "$role")"
    if api="$(jht_pi_api_provider "$provider")"; then
      if [ -z "$class" ]; then
        class=sol
        [ "$api" != claude ] || class=terra
      fi
      model="$(jht_provider_model "$api" "$class")" || return 2
    else
      model="$(resolve_codex_model "${class:-sol}")" || return 2
    fi
  fi
  [ -z "$role" ] || role_env=" JHT_HOME='${JHT_HOME:-/jht_home}' JHT_AGENT_NAME='$role'"
  key_env="$(jht_spawn_pi_key_env "$provider")" || return 2
  key_wrap="$(jht_key_wrap "$provider" "$cfg")" || return 2
  printf '%s%s%s\n' "PI_CODING_AGENT_DIR='$(jht_pi_agent_dir)' PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0${role_env} ${key_env}${key_wrap}$(jht_pi_bin) " \
    "$(jht_pi_args "$workdir" "$model" high "$provider")" "$(jht_pi_extension_args "$role")"
}

# jht_spawn_active_cli <ruolo>
#   Cosa guida il ruolo: "pi" se il config (o JHT_AGENT_HARNESS_<RUOLO>) chiede
#   pi e il provider lo regge, altrimenti il provider attivo. Per Dottore e
#   Mantenitore, che scelgono la CLI da soli. rc 2 col perché su stderr.
jht_spawn_active_cli() {
  local role="${1:-}" home="${JHT_HOME:-/jht_home}" provider cfg_harness harness auth
  provider="$(jht_spawn_active_provider)" || return 2
  cfg_harness="$(jht_config_harness "$home/jht.config.json")" || return 2
  harness="$(jht_agent_harness "$role" "$cfg_harness")" || return 2
  if [ "$harness" != "pi" ]; then
    if [ "$provider" = "glm" ]; then
      echo "Error: glm (Z.ai) runs only on the pi harness, with an API key: jht providers harness pi." >&2
      return 2
    fi
    printf '%s\n' "$provider"
    return 0
  fi
  auth="$(python3 - "$home/jht.config.json" "$provider" <<'PYEOF' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        print(str(((json.load(handle).get("providers") or {}).get(sys.argv[2]) or {}).get("auth_method") or ""))
except Exception:
    pass
PYEOF
)"
  jht_pi_provider_check "$provider" "$auth" || return 2
  printf 'pi\n'
}

# jht_spawn_mark_harness <sessione> <cli>
#   Chi legge o scrive nel pane (stepcap-watchdog, jht-tmux-send) deve sapere
#   che qui gira pi: il Ctrl-S che Kimi vuole dopo l'Enter a pi non va mandato.
jht_spawn_mark_harness() {
  [ "${2:-}" = "pi" ] || return 0
  jht_spawn_tmux set-option -t "=$1" @jht_harness pi >/dev/null 2>&1 || true
}
