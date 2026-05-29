#!/usr/bin/env bash
# Orchestrate a full snapshot of both JHT VPSes.
#
# Strictly read-only on the remote side. Does NOT trigger any agent start.
# All cutoffs and exclusions are documented in README.md.
#
# Output:
#   ~/jht-case-study-data/full-snapshot-YYYYMMDD/
#     codex-vps1/...
#     kimi-vps/...
#   ~/jht-case-study-data/jht-case-study-snapshot-YYYYMMDD.zip
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
date_tag="$(date -u +%Y%m%d)"
root="${HOME}/jht-case-study-data/full-snapshot-${date_tag}"
zip_path="${HOME}/jht-case-study-data/jht-case-study-snapshot-${date_tag}.zip"

# VPS coordinates
CODEX_HOST="${CODEX_HOST:-178.105.152.253}"
CODEX_KEY="${CODEX_KEY:-${HOME}/.ssh/jht_ed25519}"
KIMI_HOST="${KIMI_HOST:-46.224.59.127}"
KIMI_KEY="${KIMI_KEY:-${HOME}/Library/Application Support/jht-desktop/ssh/jht_ed25519}"

# Cutoffs (only timestamps STRICTLY LESS THAN are kept):
# - Codex: no cutoff needed (DB stable since 21/05 07:20 UTC, container quiet)
# - Kimi: cutoff at end of official run + buffer (involuntary restart triggered
#         subsequent activity from 23/05 onward; we keep only the original run)
CODEX_CUTOFF="${CODEX_CUTOFF:-}"
KIMI_CUTOFF="${KIMI_CUTOFF:-2026-05-20 00:00:00}"

mkdir -p "${root}"

extract_one() {
  local label="$1" host="$2" key="$3" cutoff="$4"
  local out="${root}/${label}"
  mkdir -p "${out}"
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Extracting ${label} (host=${host}, cutoff='${cutoff:-none}')"
  echo "═══════════════════════════════════════════════════════"

  echo ""
  echo "[1/5] DB tables → JSON + raw .db"
  if [[ -n "${cutoff}" ]]; then
    python3 "${here}/dump_db_tables.py" --host "${host}" --key "${key}" --out "${out}" --cutoff "${cutoff}"
  else
    python3 "${here}/dump_db_tables.py" --host "${host}" --key "${key}" --out "${out}"
  fi

  echo ""
  echo "[2/5] Host files (logs, profile, deliverables, config, charts, handoffs)"
  if [[ -n "${cutoff}" ]]; then
    python3 "${here}/dump_host_files.py" --host "${host}" --key "${key}" --out "${out}" --cutoff "${cutoff}"
  else
    python3 "${here}/dump_host_files.py" --host "${host}" --key "${key}" --out "${out}"
  fi

  echo ""
  echo "[3/5] Container session logs (wire.jsonl / rollout-*.jsonl)"
  if [[ -n "${cutoff}" ]]; then
    python3 "${here}/dump_container_sessions.py" --host "${host}" --key "${key}" --out "${out}" --cutoff "${cutoff}"
  else
    python3 "${here}/dump_container_sessions.py" --host "${host}" --key "${key}" --out "${out}"
  fi

  echo ""
  echo "[4/5] Anonymize profile YAML"
  profile_yml="${out}/.jht/profile/candidate_profile.yml"
  if [[ -f "${profile_yml}" ]]; then
    python3 "${here}/anonymize_profile.py" --in "${profile_yml}"
  else
    echo "  no profile YAML found"
  fi

  echo ""
  echo "[5/5] Manifest"
  if [[ -n "${cutoff}" ]]; then
    python3 "${here}/build_manifest.py" --out "${out}" --label "${label}" --host "${host}" --cutoff "${cutoff}"
  else
    python3 "${here}/build_manifest.py" --out "${out}" --label "${label}" --host "${host}"
  fi
}

extract_one "codex-vps1" "${CODEX_HOST}" "${CODEX_KEY}" "${CODEX_CUTOFF}"
extract_one "kimi-vps"   "${KIMI_HOST}"  "${KIMI_KEY}"  "${KIMI_CUTOFF}"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Packing final zip"
echo "═══════════════════════════════════════════════════════"
python3 "${here}/pack_zip.py" --root "${root}" --out "${zip_path}"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ DONE"
echo "═══════════════════════════════════════════════════════"
echo "  snapshot dir: ${root}"
echo "  zip archive:  ${zip_path}"
du -sh "${root}" "${zip_path}" 2>/dev/null || true
