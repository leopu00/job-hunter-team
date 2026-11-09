#!/usr/bin/env bash
# spawn-keyfile.sh — la chiave API di una corsa da un file su tmpfs (JHT_API_KEY_FILE), mai nel comando digitato
# nel pane. Il pezzo che legge e controlla il file è shared/skills/api_key_file.py; qui sta quello che start-agent.sh
# deve fare con la variabile. Senza JHT_API_KEY_FILE non cambia nulla: la chiave resta quella di sempre.

# jht_key_wrap <provider>
#   Con JHT_API_KEY_FILE stampa il prefisso da mettere nel comando del pane DOPO le assegnazioni di ambiente e
#   PRIMA del binario: il wrapper `api_key_file.py exec` legge il file, mette la chiave nell'ambiente del binario e
#   ne fa execve, quindi nel pane c'è solo il percorso del file (non è un segreto). Senza la variabile non stampa
#   niente. Prima controlla il file con `api_key_file.py check` (fail closed: file sbagliato = nessun agente, e il
#   messaggio non porta la chiave) e ferma lo spawn (rc != 0) anche per un provider senza variabile di chiave
#   (lo scorer locale non ne ha bisogno: nessun wrapper) o per un percorso con caratteri fuori da [A-Za-z0-9_./-], che non finiscono mai in un comando digitato.
jht_key_wrap() {
  local file="${JHT_API_KEY_FILE:-}" name tool
  [ -n "$file" ] || return 0
  case "${1:-}" in
    local-scorer|"") return 0 ;;   # lo scorer locale non ha una chiave di provider
    openai|codex) name=OPENAI_API_KEY ;;
    claude|anthropic) name=ANTHROPIC_API_KEY ;;
    kimi|moonshot) name=MOONSHOT_API_KEY ;;
    *) echo "Error: JHT_API_KEY_FILE is set but provider '${1:-}' has no API key variable." >&2; return 78 ;;
  esac
  case "$file" in
    /*[!A-Za-z0-9_./-]*|/*..*|[!/]*) echo "Error: JHT_API_KEY_FILE must be an absolute path of letters, digits and _ . / - only, without '..'." >&2; return 78 ;;
  esac
  tool="$(cd "$JHT_SPAWN_LIB_DIR/../shared/skills" && pwd)/api_key_file.py"
  case "$tool" in *[!A-Za-z0-9_./-]*) echo "Error: the key file tool path has characters that cannot be typed into a pane." >&2; return 78 ;; esac
  python3 "$tool" check >&2 || return $?
  printf "JHT_API_KEY_FILE='%s' python3 %s exec --env %s -- " "$file" "$tool" "$name"
}
