#!/usr/bin/env bash
# spawn-keyfile.sh — la chiave API di una corsa da un file su tmpfs o da una variabile del container, mai nel comando
# digitato nel pane. Il pezzo che legge e controlla la chiave è shared/skills/api_key_file.py; qui sta quello che
# start-agent.sh deve fare con la sorgente. Senza sorgente non cambia nulla: la chiave resta quella di sempre.
#
# Dove sta la sorgente (la stessa per OGNI lancio: team start, riavvio del watchdog, Dottore):
#   1. JHT_API_KEY_FILE nell'ambiente di chi lancia (le corse del kit di prova);
#   2. altrimenti il riferimento del provider attivo nel config (`api_key_ref`, scritto da
#      `jht setup --secret-mode file|env`): un file (percorso) o una variabile d'ambiente (nome). Il config è letto da
#      ogni lancio, quindi un riavvio fatto dal watchdog (ambiente di pid1, senza JHT_API_KEY_FILE) trova la stessa
#      chiave. Nel config c'è il percorso o il nome, mai la chiave.

# jht_key_ref <jht.config.json>
#   Stampa «file <percorso>» o «env <NOME>» se il provider attivo del config è in modalità api_key e ha un riferimento
#   a una chiave; niente se non c'è (rc 0). rc 1 col perché su stderr se il riferimento c'è ma il launcher non sa
#   risolverlo (sorgente `exec`, forma sbagliata). La chiave non viene mai stampata.
jht_key_ref() {
  [ -f "${1:-}" ] || return 0
  python3 - "$1" <<'PYEOF'
import json, re, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        cfg = json.load(handle)
    provider = (cfg.get("providers") or {}).get(cfg.get("active_provider") or "") or {}
except Exception:
    raise SystemExit(0)
ref = provider.get("api_key_ref")
if provider.get("auth_method") != "api_key" or ref is None:
    raise SystemExit(0)
ok = isinstance(ref, dict) and ref.get("type") == "ref"
if ok and ref.get("source") == "file" and isinstance(ref.get("path"), str) and ref["path"]:
    print("file", ref["path"])
elif ok and ref.get("source") == "env" and isinstance(ref.get("id"), str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", ref["id"]):
    print("env", ref["id"])
elif ok and ref.get("source") == "exec":
    print("Error: api_key_ref of the active provider has source 'exec', which the launcher does not run: use a file or an environment variable (jht setup --secret-mode file|env).", file=sys.stderr)
    raise SystemExit(1)
else:
    print("Error: api_key_ref of the active provider is not a reference to a file or an environment variable.", file=sys.stderr)
    raise SystemExit(1)
PYEOF
}

# jht_key_wrap <provider> [jht.config.json]
#   Con una sorgente stampa il prefisso da mettere nel comando del pane DOPO le assegnazioni di ambiente e PRIMA del
#   binario: il wrapper `api_key_file.py exec` legge la chiave, la mette nell'ambiente del binario e ne fa execve,
#   quindi nel pane c'è solo il percorso del file o il nome della variabile (non sono segreti). Senza sorgente non
#   stampa niente. Prima controlla la chiave con `api_key_file.py check` (fail closed: sorgente sbagliata = nessun
#   agente, e il messaggio non porta la chiave) e ferma lo spawn (rc != 0) anche per un provider senza variabile di
#   chiave o per un percorso con caratteri fuori da [A-Za-z0-9_./-], che non finiscono mai in un comando digitato.
#   Lo scorer locale non ha una chiave di provider: nessun wrapper.
jht_key_wrap() {
  local provider="${1:-}" cfg="${2:-}" file="${JHT_API_KEY_FILE:-}" var="" name tool kind ref
  case "$provider" in local-scorer|"") return 0 ;; esac
  if [ -z "$file" ]; then
    ref="$(jht_key_ref "$cfg")" || return 78
    kind="${ref%% *}"
    case "$kind" in file) file="${ref#* }" ;; env) var="${ref#* }" ;; esac
  fi
  [ -n "$file$var" ] || return 0
  case "$provider" in
    openai|codex) name=OPENAI_API_KEY ;;
    claude|anthropic) name=ANTHROPIC_API_KEY ;;
    kimi|moonshot) name=MOONSHOT_API_KEY ;;
    *) echo "Error: a key source is set but provider '$provider' has no API key variable." >&2; return 78 ;;
  esac
  tool="$(cd "$JHT_SPAWN_LIB_DIR/../shared/skills" && pwd)/api_key_file.py"
  case "$tool" in *[!A-Za-z0-9_./-]*) echo "Error: the key file tool path has characters that cannot be typed into a pane." >&2; return 78 ;; esac
  if [ -n "$var" ]; then
    python3 "$tool" check --from-env "$var" >&2 || return $?
    printf "python3 %s exec --env %s --from-env %s -- " "$tool" "$name" "$var"
    return 0
  fi
  case "$file" in
    /*[!A-Za-z0-9_./-]*|/*..*|[!/]*) echo "Error: the key file must be an absolute path of letters, digits and _ . / - only, without '..'." >&2; return 78 ;;
  esac
  JHT_API_KEY_FILE="$file" python3 "$tool" check >&2 || return $?
  printf "JHT_API_KEY_FILE='%s' python3 %s exec --env %s -- " "$file" "$tool" "$name"
}
