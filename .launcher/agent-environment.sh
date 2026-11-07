# Env OPZIONALI che, quando esistono, devono arrivare all'agente. Le liste di
# export qui sotto sono esplicite per costruzione — una tmux nuova non eredita
# l'ambiente di questo processo, e sul ramo PowerShell (WSL) non eredita
# proprio niente da bash — quindi una variabile che non è in lista, per
# l'agente non esiste.
#
# Il caso che ha aperto questa lista (issue #132, 2026-08-08):
# `JHT_SCOUT_COORD_DB` è l'UNICA deroga ammessa quando il percorso canonico del
# database di coordinamento non è scrivibile. Il bootstrap pre-spawn la vedeva
# (gira in questo processo) e lo Scout no: la deroga non raggiungeva chi la
# doveva usare, e l'agente usciva 3 proprio sulla piattaforma dell'incidente.
#
# Si propagano SOLO se valorizzate: esportare una stringa vuota renderebbe
# indistinguibile "non dichiarata" da "dichiarata male".
OPTIONAL_AGENT_ENV=(JHT_SCOUT_COORD_DB JHT_LANG)

send_optional_env() {
  # $1 = "bash" | "powershell" — la sintassi cambia, la lista no.
  local _name _value _session="${2:-$SESSION}"
  for _name in "${OPTIONAL_AGENT_ENV[@]}"; do
    _value="${!_name:-}"
    if [ -n "$_value" ]; then
      if [ "$1" = "powershell" ]; then
        jht_spawn_tmux send-keys -t "$_session" "\$env:$_name='$_value'" Enter || return $?
      else
        jht_spawn_tmux send-keys -t "$_session" "export $_name='$_value'" C-m || return $?
      fi
    fi
  done
}
