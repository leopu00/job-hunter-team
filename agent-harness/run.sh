#!/bin/sh
# Run the harness.   Usage:  ./run.sh -p "your prompt"
# Unix twin of run.ps1. Keys live in .env, which git ignores.
set -e
cd "$(dirname "$0")"
exec uv run --project . --env-file .env --quiet -m app.main "$@"
