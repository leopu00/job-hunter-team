#!/usr/bin/env bash
# The wizard and launcher read this same role/model table.
JHT_ROLE_MODELS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../shared/runtime" && pwd)/role-models.list"

jht_role_model_value() {
  local requested="$1" field="$2" kind class codex claude legacy
  while IFS='|' read -r kind class codex claude legacy; do
    [ "$kind" = model ] || continue
    if [ "$requested" = "$class" ] || [ "$requested" = "$legacy" ] ||
        { [ -n "$claude" ] && [ "$requested" = "$claude" ]; }; then
      case "$field" in
        codex) printf '%s\n' "$codex" ;;
        legacy) printf '%s\n' "$legacy" ;;
        *) return 1 ;;
      esac
      return 0
    fi
  done < "$JHT_ROLE_MODELS_FILE"
  echo "Error: no Codex model mapping for role alias '$requested'." >&2
  return 1
}

get_agent_info() {
  local role="$1" kind name class effort prefix alias
  while IFS='|' read -r kind name class effort prefix; do
    [ "$kind" = role ] && [ "$name" = "$role" ] || continue
    alias="$(jht_role_model_value "$class" legacy)" || return 1
    printf '%s|%s|%s\n' "$prefix" "$effort" "$alias"
    return 0
  done < "$JHT_ROLE_MODELS_FILE"
  printf '\n'
}

resolve_codex_model() {
  jht_role_model_value "$1" codex
}
