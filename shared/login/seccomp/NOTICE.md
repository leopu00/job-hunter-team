# Third-party notice: the seccomp profiles of the sign-in browser

`moby-default.json` in this folder is a copy, byte for byte, of the file `seccomp/default.json` of the repository
https://github.com/moby/profiles at the commit `7b5ccfab2d6b4e0aa64c6cce401a2705788eafeb` (2 November 2026), fetched from
`https://raw.githubusercontent.com/moby/profiles/7b5ccfab2d6b4e0aa64c6cce401a2705788eafeb/seccomp/default.json`
(SHA-256 `15434cc9c9037d85b35027a60721bf45f381782b4283b01d94663366e71569f8`, the value `tests/test_login_seccomp_profile.py` keeps).

That file is the default seccomp profile of Docker, licensed under the Apache License, Version 2.0, Copyright The Moby/Docker authors. The
text of the license is at https://www.apache.org/licenses/LICENSE-2.0 and is also the `LICENSE` file of that repository.

`jht-login.json` is a MODIFIED version of that file: the same profile with one rule added at the end of `syscalls` (clone and unshare allowed
for the user, pid and net namespaces that the sandbox of Chromium makes). It is written from `moby-default.json` by
`scripts/ci/login_seccomp.py build`, and what it changes is described in that script. The rest of this repository is under its own license
(see the `LICENSE` file at the root); these two JSON files are the only third-party content in `shared/login/`.
