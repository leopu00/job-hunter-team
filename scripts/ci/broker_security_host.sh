#!/usr/bin/env bash
# The broker's security profiles on a real Linux host (R3, T2), for the
# broker-sandbox CI job: install.sh's own step installs them as root, from
# this checkout, and jht up's own check reads them back.
#
# - as root, jht up must add both overrides ("apparmor"): FAIL otherwise;
# - as the runner's user (not root), what jht up sees is printed as a
#   MEASURE line: whether a non-root `jht up` can tell the profile is loaded
#   depends on what the kernel lets a user read of AppArmor's securityfs.
#
# Usage: scripts/ci/broker_security_host.sh   (from the repository root)
set -euo pipefail

repo="$(pwd)"
sudo env JHT_INSTALLER_SOURCE_ONLY=1 REPO="$repo" bash -c '
  . "$REPO/scripts/install.sh" --broker-profiles
  OS=linux
  RUNTIME_RELEASE_BASE="file://$REPO"
  install_broker_security_profiles
'

check="$(mktemp)"
trap 'rm -f "$check"' EXIT
{
  echo 'HOST_KERNEL=Linux'
  grep -E '^(BROKER_SERVICE|BROKER_SECURITY_DIR|APPARMOR_ENABLED_FILE|APPARMOR_FS|BROKER_APPARMOR_PROFILE)=' \
    scripts/jht-wrapper.sh
  for name in runtime_stat broker_security_node_safe host_apparmor_enabled broker_apparmor_loaded broker_security_mode; do
    sed -n "/^$name() {/,/^}/p" scripts/jht-wrapper.sh
  done
  # shellcheck disable=SC2016 # the line is written for the check script
  echo 'broker_security_mode "$1"'
} > "$check"

as_user="$(bash "$check" "$repo/docker-compose.yml")"
as_root="$(sudo bash "$check" "$repo/docker-compose.yml")"
# What a non-root jht up can read, step by step: the mode bits are not the
# answer (the profile list says readable, and the kernel refuses the open).
step() { if "$@" >/dev/null 2>&1; then echo yes; else echo no; fi; }
echo "MEASURE user-reads apparmor-enabled=$(step cat /sys/module/apparmor/parameters/enabled)" \
  "profile-list-mode-readable=$(step test -r /sys/kernel/security/apparmor/profiles)" \
  "profile-list-opens=$(step cat /sys/kernel/security/apparmor/profiles)" \
  "policy-dir-lists=$(step ls /sys/kernel/security/apparmor/policy/profiles)" \
  "policy-name-reads=$(step sh -c 'cat /sys/kernel/security/apparmor/policy/profiles/*/name')"
echo "MEASURE jht-up-broker-security user=${as_user:-none} root=${as_root:-none}"
ls -l /etc/jht/security /etc/apparmor.d/jht-broker

if [ "$as_root" != "apparmor" ]; then
  echo "FAIL [host-profiles] after install.sh, jht up as root adds '${as_root:-nothing}', not both overrides"
  exit 1
fi
echo "checks done: 0 failed"
