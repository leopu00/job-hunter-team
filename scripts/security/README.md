# Security profiles of the `jht-broker` container

Chromium's sandbox in the broker's login browser (design R3, way a) needs two
host profiles; on Linux the installer loads them and `jht up` applies them
only when they are loaded, so a missing profile never stops mail.

| File | Derived from | What is added |
| --- | --- | --- |
| `jht-broker.seccomp.json` | `github.com/moby/profiles` `seccomp/v0.2.4` `default.json` (Apache-2.0) | `clone` and `unshare` may create user, PID and network namespaces; mount, cgroup, UTS and IPC stay denied; `clone3` stays ENOSYS; `chroot` without the `CAP_SYS_CHROOT` condition. Taken away: the 32-bit sub-architectures of x86_64 and aarch64, and `socketcall` (now refused) |
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

**Why `chroot` is let through without a capability.** After creating its
user namespace, Chromium chroots into an empty directory
(`/proc/self/fdinfo/`), where it holds `CAP_SYS_CHROOT` over that namespace
only. Upstream's profile allows `chroot` only to a container that keeps
`CAP_SYS_CHROOT`, and the broker drops every capability: on the
broker-sandbox CI job (run 37872819366) Chromium stopped on
`Check failed: sys_chroot("/proc/self/fdinfo/") == 0`, with no AppArmor
denial (a seccomp errno is not logged). Outside a user namespace of its
own, a process with no capability is still refused by the kernel: the CI
job checks that the broker's Python cannot chroot *directly*. If it first
creates a user namespace of its own, it can chroot inside it, as Chromium
does. That is the residue already accepted with `userns,` in the whole
profile (above): no surface beyond it, since the chroot reaches nothing the
new namespace did not already hold.

## How they reach the host, per platform

**Linux (VPS and desktop), `scripts/install.sh`.** After the runtime files,
the installer downloads both profiles from the same commit, checks that they
are the profiles, and installs them as root, once: the seccomp profile and
two compose overrides in `/etc/jht/security/` (root, 0644), and, where the
kernel uses AppArmor, `/etc/apparmor.d/jht-broker`, loaded with
`apparmor_parser -r -W`. Run as root (a VPS) it asks nothing; a user is asked
once, with sudo; `--broker-profiles` / `--no-broker-profiles` decide without
asking. Any failure is a warning: mail never depends on the profiles.

**`jht up` (`scripts/jht-wrapper.sh`).** Every compose call adds
`compose-seccomp.yml` and, with AppArmor, `compose-apparmor.yml` to
`jht-broker` only when the files are root's and not writable by others and
the profile is loaded in enforce mode (`profiles`, readable by root, or the
profile's `name` and `mode` under `policy/`). Otherwise nothing is added:
the broker starts with the engine's defaults, its `confinement()` is not
ready, the login view answers `secure_browser_unavailable`, and `jht up` says
so with what to do. Whether a non-root `jht up` can see the loaded profile
depends on what the kernel lets a user read: the broker-sandbox CI job
measures it (`scripts/ci/broker_security_host.sh`), and checks that as root
the installer's step and `jht up` agree.

**Linux with rootless Podman (stage 1 of the Podman plan).** Rootless Podman
applies no AppArmor profile, and refuses a container that asks for one
(measured with Podman 4.9.3: exit 125). There `jht up` passes the seccomp
profile only, and the broker accepts it, by the security review's decision (a) of
09/10, only when all of these hold, read from its own `/proc/self`:
- the container is rootless: `uid_map` is not the identity map, and uid 0
  inside maps to a uid other than 0 outside;
- `Seccomp: 2`, `NoNewPrivs: 1`, and no effective capability (`CapEff`);
  these hold everywhere, Docker included.
What AppArmor's `deny network alg` and `deny network vsock` gave, seccomp
gives here: upstream's profile allows `socket` for families below 38 and
39, 41-45 only, so AF_ALG (38) and AF_VSOCK (40) are refused (pinned by a
test). That rule reads the family of `socket()` only: 32-bit code (int 0x80
on x86_64, AArch32 on arm64) and `socketcall`, whose family sits behind a
pointer, went past it. The profile therefore has no 32-bit sub-architecture
on x86_64 and aarch64 (a 32-bit call meets the wrong-architecture action),
and refuses `socketcall`; the image's Chromium and Python are 64-bit, and CI
checks it. A static 32-bit probe (`scripts/ci/compat32_socket.c.txt`) must open
nothing under the profile, under Docker and rootless Podman on x86_64, and
on a native arm64 runner (qemu-user would turn its calls into 64-bit ones
before seccomp sees them). Rootful Docker without the `jht-broker` label stays off. The
`broker-sandbox-podman` CI job is the gate: under rootless Podman the broker
ready and Chromium sandboxed, no mount namespace, chroot, AF_ALG or AF_VSOCK
from the broker's Python, and a rootful container without the label off.
Chromium under its own uid (P2-3) stays a requirement of phase 2.

**Mac (Colima, Podman machine, Docker Desktop).** The containers run in a
Linux VM; the wrapper adds no override on macOS, so the broker runs with the
VM engine's default profiles and the login view stays off
(`secure_browser_unavailable`), fail closed. Not measured on a machine yet:
which LSM each VM runs (Podman's machine is Fedora-based, with SELinux;
Colima's is Ubuntu), and so whether the seccomp profile alone would do there.
Either way the profiles have to live inside the VM, which no step puts there
yet: it is the Mac part of T3/T4.

**Windows (Podman in WSL).** The same as the Mac: the PowerShell wrapper adds
no override, and the login view stays off until the seccomp profile is
carried into the Podman machine (stage 3 of the Podman plan). Whether the
WSL2 kernel runs AppArmor there is not measured.
