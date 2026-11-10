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
        class) printf '%s\n' "$class" ;;
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

# The providers that run only on pi with an API key (glm, kimi): shared/runtime/provider-models.list, the same table the CLI reads.
JHT_PROVIDER_MODELS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../shared/runtime" && pwd)/provider-models.list"

# jht_pi_api_provider <name> — glm | kimi for the names that mean them (moonshot is kimi), else rc 1.
jht_pi_api_provider() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    glm) printf 'glm\n' ;;
    kimi|moonshot) printf 'kimi\n' ;;
    *) return 1 ;;
  esac
}

# jht_provider_field <glm|kimi> pi|key — the name pi knows the provider by, or the variable its key goes in.
jht_provider_field() {
  local wanted="$1" field="$2" kind name pi key label
  while IFS='|' read -r kind name pi key label; do
    [ "$kind" = provider ] && [ "$name" = "$wanted" ] || continue
    case "$field" in pi) printf '%s\n' "$pi" ;; key) printf '%s\n' "$key" ;; *) return 1 ;; esac
    return 0
  done < "$JHT_PROVIDER_MODELS_FILE"
  return 1
}

# jht_provider_model <glm|kimi> <class or alias of the role: sol, terra, luna, sonnet…> — the model id pi gets.
jht_provider_model() {
  local provider="$1" requested="$2" class kind name modelclass model
  class="$(jht_role_model_value "$requested" class)" || return 1
  while IFS='|' read -r kind name modelclass model; do
    [ "$kind" = model ] && [ "$name" = "$provider" ] && [ "$modelclass" = "$class" ] || continue
    printf '%s\n' "$model"
    return 0
  done < "$JHT_PROVIDER_MODELS_FILE"
  echo "Error: no $provider model for the class '$class'." >&2
  return 1
}
