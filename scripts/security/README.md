# Security profiles of the `jht-broker` container

Chromium's sandbox in the broker's login browser (design R3, way a) needs two
host profiles; the installer loads them and `jht up` applies them only when
they are loaded, so a missing profile never stops mail.

| File | Derived from | What is added |
| --- | --- | --- |
| `jht-broker.seccomp.json` | `github.com/moby/profiles` `seccomp/v0.2.4` `default.json` (Apache-2.0) | `clone` and `unshare` may create user, PID and network namespaces; mount, cgroup, UTS and IPC stay denied; `clone3` stays ENOSYS |
| `jht-broker.apparmor.txt` | `github.com/moby/profiles` `apparmor/v0.2.3` template (Apache-2.0) | `userns,`; signal and ptrace among the container's processes also with Podman's stacked label; ABI 4.0 with `unix,` |

`tests/test_broker_security_profiles.py` checks that nothing else differs from
the upstream defaults.

**Where the host has no AppArmor** (SELinux hosts, the Mac's Podman machine)
only the seccomp profile applies. seccomp cannot tell binaries apart, so
there every process of the broker's container may create user, PID and
network namespaces, not just Chromium. Mount, cgroup, UTS and IPC namespaces
stay refused everywhere.

**Why `userns,` is in the whole profile, not only Chromium's binary.** A
child profile for Chromium, entered at the exec of its binary, would keep
user namespaces away from the broker's Python. It was tried and measured on
the broker-sandbox CI job (run 37871171379): the kernel refused the
transition, `apparmor="DENIED" operation="exec" info="no new privs"
profile="jht-broker" target="jht-broker//chromium"`. The broker runs with
`no-new-privileges`, and under it AppArmor admits no transition to a
profile that grants more than the current one; the child exists precisely
to grant `userns`. Keeping `no-new-privileges` was judged worth more than
confining `userns` to one binary. So any process of the container, the
broker's Python included, may create user, PID and network namespaces,
exactly as Chromium may. A mount namespace stays refused to every process
(the CI job checks both from the broker's Python).
