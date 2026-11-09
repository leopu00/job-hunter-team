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

# jht_pi_extension_args <ruolo>
#   Gli argomenti di pi in più per quel ruolo: l'estensione di ricerca (-e esplicito: vale con -ne), solo per i
#   ruoli con la ricerca web su Codex. Se il file manca lo dice e il ruolo parte senza ricerca, invece di far
#   fallire pi all'avvio. Si accoda a jht_pi_args.
jht_pi_extension_args() {
  local role="${1:-}"
  [ -n "$role" ] && jht_codex_web_search_role "$role" || return 0
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
    print(f"Error: harness {value!r} in '{path}' is not a known agent harness ({', '.join(known)}); fix it with: jht providers harness codex", file=sys.stderr)
    raise SystemExit(2)
print(value)
PYEOF
}

# jht_spawn_pi_repl_cmd <workdir> [modello]
#   Il comando di pi per i servizi che non passano da start-agent.sh (Dottore,
#   Mantenitore), con gli stessi argomenti di un ruolo del team. Il modello è
#   quello dato o, senza, la classe sol (il default di Codex). Ferma lo spawn
#   (rc 2, perché su stderr) se mancano l'identità o le skill nella workdir,
#   il pi del pin o le settings leggibili.
jht_spawn_pi_repl_cmd() {
  local workdir="${1:-}" model="${2:-}"
  if [ ! -s "$workdir/AGENTS.md" ] || [ ! -d "$workdir/.agents/skills" ]; then
    echo "[spawn-lib] ERROR: pi needs $workdir/AGENTS.md and $workdir/.agents/skills before it starts; one is missing." >&2
    return 2
  fi
  jht_pi_version_check || return 2
  jht_pi_settings "$(jht_pi_agent_dir)/settings.json" || return 2
  if [ -z "$model" ]; then
    # shellcheck source=/dev/null
    . "$JHT_SPAWN_LIB_DIR/role-models.sh"
    model="$(resolve_codex_model sol)" || return 2
  fi
  printf '%s%s\n' "PI_CODING_AGENT_DIR='$(jht_pi_agent_dir)' PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 $(jht_pi_bin) " \
    "$(jht_pi_args "$workdir" "$model" high)"
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
