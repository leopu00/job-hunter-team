#!/usr/bin/env bash
# Rebuild the local /case-studies SQLite DB from schema.sql + seed.sql.
# The .db file itself is gitignored — only schema.sql + seed.sql are versioned.
# Run from anywhere; uses script-relative paths.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
db="$here/case-studies.db"

rm -f "$db" "$db-shm" "$db-wal"

sqlite3 "$db" < "$here/schema.sql"
sqlite3 "$db" < "$here/seed.sql"

n_cs=$(sqlite3 "$db" "SELECT COUNT(*) FROM case_studies")
n_metrics=$(sqlite3 "$db" "SELECT COUNT(*) FROM case_study_metrics")
n_notes=$(sqlite3 "$db" "SELECT COUNT(*) FROM case_study_notes")
n_cov=$(sqlite3 "$db" "SELECT COUNT(*) FROM coverage_matrix")

echo "✓ DB rebuilt: $db"
echo "  case_studies:        $n_cs"
echo "  case_study_metrics:  $n_metrics"
echo "  case_study_notes:    $n_notes"
echo "  coverage_matrix:     $n_cov"
