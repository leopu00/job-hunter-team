#!/usr/bin/env bash
# shared/i18n.sh — minimal bash i18n helper
#
# Usage:
#   source /app/shared/i18n.sh          # in-container path
#   source ./shared/i18n.sh             # repo-relative
#   echo "$(t welcome.capitano)"        # lookup by key
#
# Reads canonical i18n-prefs.json, then bootstrap JHT_LANG/host.env, then 'en'.
# Catalog: shared/locales/<lang>.json (master = en).
# Missing key: returns the key itself (visible in dev, doesn't break UI).
# Missing catalog file: falls back to en silently.
#
# Designed for cheap, dependency-light shell scripts. Requires jq.

# Resolve catalog dir relative to this script (so it works regardless of CWD).
_I18N_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/locales"

# Resolve language with cascade lookup (prefs → env → host.env → default en).
_i18n_resolve_lang() {
  local home="${JHT_HOME:-/jht_home}" lang="" prefs
  prefs="$home/i18n-prefs.json"
  if [ -f "$prefs" ] && command -v jq >/dev/null 2>&1; then
    lang="$(jq -r '.locale // empty' "$prefs" 2>/dev/null || true)"
    case "$lang" in en|it|hu|es|de|fr|pt) printf '%s' "$lang"; return ;; esac
  fi
  case "${JHT_LANG:-}" in
    en|it|hu|es|de|fr|pt) printf '%s' "$JHT_LANG"; return ;;
  esac
  local host_env="${JHT_HOST_ENV_FILE:-$home/host.env}"
  if [ -f "$host_env" ]; then
    lang="$(grep -E '^JHT_LANG=' "$host_env" 2>/dev/null | cut -d= -f2 | tr -d '"' | head -1)"
    case "$lang" in en|it|hu|es|de|fr|pt) printf '%s' "$lang"; return ;; esac
  fi
  printf 'en'
}

# The launch tutorial is English-only during phase 1. Keep the locale
# selector and all later product copy untouched, but read the approved T0-T1
# onboarding keys from the English catalog even when an existing host.env is
# still set to Italian.
_i18n_phase1_english() {
  case "$1" in
    host_setup.*|welcome.*|wizard.welcome_subtitle|wizard.aborted_prereqs|\
    wizard.checks.*|wizard.cloud.*|wizard.step.*|wizard.profile.intro|wizard.provider.*|wizard.cli.*|\
    wizard.oauth.*|wizard.team.starting|wizard.team.start_failed|\
    wizard.outro_done|wizard.outro_aborted|wizard.start.ready|wizard.start.done)
      return 0 ;;
  esac
  return 1
}

# Lookup a string from the catalog. Falls back to en if missing.
# Args: $1 = key (e.g. "welcome.capitano")
t() {
  local key="$1"
  local lang
  lang="$(_i18n_resolve_lang)"
  local catalog="$_I18N_DIR/$lang.json"
  local fallback="$_I18N_DIR/en.json"
  local value

  if _i18n_phase1_english "$key"; then
    catalog="$fallback"
  fi

  if [ -f "$catalog" ]; then
    value="$(jq -r --arg k "$key" '.[$k] // empty' "$catalog" 2>/dev/null)"
    if [ -n "$value" ] && [ "$value" != "null" ]; then
      printf '%s' "$value"
      return
    fi
  fi

  # Fallback to en if key missing in target lang
  if [ -f "$fallback" ]; then
    value="$(jq -r --arg k "$key" '.[$k] // empty' "$fallback" 2>/dev/null)"
    if [ -n "$value" ] && [ "$value" != "null" ]; then
      printf '%s' "$value"
      return
    fi
  fi

  # Key not found anywhere: emit the key (visible in dev)
  printf '%s' "$key"
}

# Lookup with printf-style substitution.
# Args: $1 = key, $@ = substitution args
# Example: tf "host_setup.swap_low_ram" 4 → "With 4 GB of RAM ..."
tf() {
  local key="$1"
  shift
  local template
  template="$(t "$key")"
  # shellcheck disable=SC2059
  printf "$template" "$@"
}

export -f t tf 2>/dev/null || true
