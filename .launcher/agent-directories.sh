#!/usr/bin/env bash
# Sourced by start-agent.sh after config.sh has resolved the team's folders.
# This runs inside the container; it does not change any host runtime.

mkdir -p "$JHT_HOME" "$JHT_AGENTS_DIR" "$JHT_LOGS_DIR"
mkdir -p "$JHT_USER_DIR/cv" "$JHT_USER_DIR/critiche" "$JHT_USER_DIR/allegati" "$JHT_USER_DIR/output"

# CODEX_SQLITE_HOME moves only the SQLite databases to the native deps volume;
# the login, configuration and sessions stay in CODEX_HOME (docs/adr/0013).
# Codex can create the folder itself, but the launcher first restricts it to
# its owner. Older compose files without the variable keep their old behavior.
if [ "$CLI_BIN" = "codex" ] && [ -n "${CODEX_SQLITE_HOME:-}" ]; then
  if mkdir -p "$CODEX_SQLITE_HOME" 2>/dev/null && chmod 700 "$CODEX_SQLITE_HOME" 2>/dev/null; then
    # mkdir elects one announcer even when all agents start together. A failed
    # append must release its marker so a later start can try again.
    if ! ls "$CODEX_SQLITE_HOME"/*.sqlite >/dev/null 2>&1 \
       && mkdir "$CODEX_SQLITE_HOME/.announced" 2>/dev/null; then
      if ! printf '[%s] codex-state: new folder %s (no databases in it: first start, or the volume was recreated); first agent: %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CODEX_SQLITE_HOME" "$ROLE" >> "$JHT_LOGS_DIR/codex-state.log"; then
        echo "⚠️  codex-state: cannot write the new-folder announcement; a later start can retry" >&2
        if ! rmdir "$CODEX_SQLITE_HOME/.announced"; then
          echo "⚠️  codex-state: cannot release the announcement marker" >&2
        fi
      fi
    fi
  else
    echo "⚠️  CODEX_SQLITE_HOME ($CODEX_SQLITE_HOME) cannot be created: Codex will try itself"
  fi
fi
