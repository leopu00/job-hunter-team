#!/usr/bin/env python3
"""Does the browser of the manual LinkedIn sign-in keep its sandbox and keep nothing of the person? Answered on a real engine, with no account.

Starts IMAGE (the extras image) the way docker-compose.yml starts `jht-login` — the user, the read-only root, the tmpfs, the limits,
`cap_drop`, `cap_add`, `security_opt` and `network_mode: none` are read from the compose file, not copied — with ONE difference: the
command is scripts/ci/login_live_probe_inside.py, which runs the real sign-in code of the image against a page of its own (see there).

  1. main run     the sandbox is on (chrome://sandbox), the form is typed and sent, the cookie is seen, the browser is closed by the
                  watcher, and then Login Data, Web Data and every byte of the profile folder are read: no saved password, no autofill, no
                  user name, no password;
  2. --controls   the same run with the folder of managed policies of the image covered by an empty one: it must NOT be clean in the same way
                  (so the policy is what keeps the profile empty), and a run without SYS_CHROOT: the sandbox does not start.

The profile folder is a volume the engine makes (default) or, with --profile-dir PARENT, a NEW folder with a random name made inside the
existing folder PARENT (which is how the product mounts its profile: a folder of the host). Only that new folder is ever written to or
emptied: nothing that was already in PARENT is touched, and a PARENT that is not a folder is refused.

  login_live_probe.py IMAGE [--engine docker|podman] [--connection NAME] [--profile-dir DIR] [--controls]
Exit 0 when every check of the main run passes (and, with --controls, the controls say what they should); 1 with the FAIL lines.
Used by .github/workflows/docker.yml on the image just built (Docker on Linux); by hand on Podman and on Colima.
"""

from __future__ import annotations

import argparse
import os
import secrets
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # a run that cannot read the compose file is red, never green
    sys.exit("login_live_probe: PyYAML is needed to read docker-compose.yml (pip install pyyaml)")

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "docker-compose.yml"
INSIDE = Path(__file__).with_name("login_live_probe_inside.py")
SERVICE = "jht-login"
PROFILE_MOUNT = "/linkedin-profile"
POLICY_DIR = "/etc/chromium/policies/managed"
TIMEOUT = 240


def service() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"][SERVICE]


def hardening_flags(spec: dict, without_chroot: bool) -> list[str]:
    """The flags of the service as the compose file says them (the volumes and the command are the probe's own)."""
    flags = ["--user", str(spec["user"]), "--network", str(spec["network_mode"]), "--entrypoint", "/usr/bin/tini"]
    if spec.get("read_only"):
        flags.append("--read-only")
    for path in spec.get("tmpfs") or []:
        flags += ["--tmpfs", str(path)]
    if spec.get("pids_limit"):
        flags += ["--pids-limit", str(spec["pids_limit"])]
    if spec.get("mem_limit"):
        flags += ["--memory", str(spec["mem_limit"])]
    if spec.get("cpus"):
        flags += ["--cpus", str(spec["cpus"])]
    for option in spec.get("security_opt") or []:
        flags += ["--security-opt", str(option).replace("no-new-privileges:true", "no-new-privileges")]
    for cap in spec.get("cap_drop") or []:
        flags += ["--cap-drop", str(cap)]
    if not without_chroot:
        for cap in spec.get("cap_add") or []:
            flags += ["--cap-add", str(cap)]
    for item in spec.get("environment") or []:
        flags += ["-e", str(item)]
    return flags


def engine_argv(engine: str, connection: str) -> list[str]:
    """Podman on a named connection, Docker on a named context (Colima: `colima`); without a name, the engine as it is found."""
    if not connection:
        return [engine]
    return [engine, "--connection", connection] if engine == "podman" else [engine, "--context", connection]


def engine_report(engine: list[str], kind: str) -> str:
    """Which engine this is, exactly (the profile of a VM engine such as Colima is the context the client is pointed at)."""
    def ask(*args: str) -> str:
        try:
            done = subprocess.run([*engine, *args], capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            return "?"
        return (done.stdout or done.stderr).strip().replace("\n", " ")[:120] or "?"
    if kind == "docker":
        context = engine[2] if len(engine) > 2 else ask("context", "show")
        return (f"docker {ask('version', '--format', '{{.Server.Version}}')}, context {context}, "
                f"host {ask('info', '--format', '{{.Name}} / {{.OperatingSystem}} / {{.KernelVersion}} / {{.Architecture}}')}")
    return (f"podman {ask('version', '--format', '{{.Version}}')}, connection {engine[2] if len(engine) > 2 else 'local'}, "
            f"host {ask('info', '--format', '{{.Host.Hostname}} / {{.Host.OS}} / {{.Host.Kernel}} / {{.Host.Arch}}')}")


class Probe:
    def __init__(self, engine: list[str], image: str, profile_parent: str | None, seccomp_profile: str | None = None) -> None:
        self.engine, self.image = engine, image
        # a profile of our own for the engine's seccomp filter (the one Docker applies by default stops the namespace sandbox of Chromium)
        self.seccomp = ["--security-opt", f"seccomp={Path(seccomp_profile).resolve()}"] if seccomp_profile else []
        self.profile_parent = Path(profile_parent) if profile_parent else None
        self.spec = service()

    def make_profile_dir(self) -> Path:
        """A folder that did not exist a moment ago, inside the one the person named: the only one this probe writes to and empties."""
        parent = self.profile_parent
        if parent is None or parent.is_symlink() or not parent.is_dir():
            raise ValueError("--profile-dir must be an existing folder (a link is not one)")
        folder = parent / ("jht-login-probe-" + secrets.token_hex(6))
        folder.mkdir(mode=0o777)  # not exist_ok: a name that is taken is an error
        folder.chmod(0o777)  # the browser's user (1001) writes here, whoever owns the host folder
        return folder

    def run(self, *, without_chroot: bool = False, cover_policy: bool = False, extra: tuple[str, ...] = (), mode: tuple[str, ...] = ()) -> tuple[int, str]:
        name = "jht-login-probe-" + secrets.token_hex(3)
        volume = name + "-profile"
        cleanup: list[list[str]] = []
        host_folder: Path | None = None
        try:
            if self.profile_parent is None:
                profile = volume
                subprocess.run([*self.engine, "volume", "create", volume], check=True, capture_output=True, timeout=60)
                cleanup.append([*self.engine, "volume", "rm", "-f", volume])
                # a new volume belongs to root: the browser's user must be able to write in it
                subprocess.run([*self.engine, "run", "--rm", "--user", "0:0", "--entrypoint", "/bin/chown", "-v", f"{volume}:/p",
                                self.image, "1001:1001", "/p"], check=True, capture_output=True, timeout=120)
            else:
                host_folder = self.make_profile_dir()
                profile = str(host_folder)
            cmd = [*self.engine, "run", "--rm", "--name", name, *hardening_flags(self.spec, without_chroot), *self.seccomp, *extra,
                   "-v", f"{INSIDE}:/probe/inside.py:ro", "-v", f"{profile}:{PROFILE_MOUNT}"]
            if cover_policy:
                # an empty folder over the folder of managed policies: no host path, so it works where the host's folders are not shared
                # with the engine (Colima, Docker Desktop)
                cmd += ["--tmpfs", f"{POLICY_DIR}:ro,size=4k"]
            cmd += [self.image, "-g", "--", "python3", "/probe/inside.py", *(mode or ("--profile", PROFILE_MOUNT))]
            if without_chroot and not mode:
                cmd.append("--no-chroot")
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
                return result.returncode, result.stdout + result.stderr
            except subprocess.TimeoutExpired:
                subprocess.run([*self.engine, "rm", "-f", name], capture_output=True, timeout=60)
                return 124, f"FAIL [timeout] the probe did not end in {TIMEOUT} s\n"
        finally:
            if host_folder is not None:
                # what the browser wrote belongs to its user: the same user takes it away, from the folder this run made and no other
                subprocess.run([*self.engine, "run", "--rm", "--user", "1001:1001", "--entrypoint", "/bin/sh", "-v",
                                f"{host_folder}:/p", self.image, "-c", "rm -rf /p/* /p/.[!.]* 2>/dev/null; true"],
                               capture_output=True, timeout=120)
                try:
                    os.rmdir(host_folder)
                except OSError:
                    print(f"INFO [cleanup] {host_folder} was not emptied: remove it by hand")
            for command in cleanup:
                subprocess.run(command, capture_output=True, timeout=60)


def lines(output: str, kind: str) -> list[str]:
    return [line for line in output.splitlines() if line.startswith(kind + " ")]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("image")
    parser.add_argument("--engine", choices=("docker", "podman"), default="docker")
    parser.add_argument("--connection", default="", help="Podman connection, or Docker context (never the default machine of a Mac or Windows)")
    parser.add_argument("--profile-dir", default=None, help="an EXISTING folder of the host; the profile is a new folder made inside it (how the product mounts it)")
    parser.add_argument("--controls", action="store_true")
    parser.add_argument("--seccomp-profile", default=None, help="run with this seccomp profile instead of the engine's default (to test a candidate)")
    parser.add_argument("--diagnose", action="store_true",
                        help="only report what the kernel and the engine's filters say about the user namespace and chroot the sandbox needs, "
                             "in the container as the service has it and in three looser ones (the looser ones are a diagnosis, never a way to run)")
    args = parser.parse_args(argv)
    probe = Probe(engine_argv(args.engine, args.connection), args.image, args.profile_dir, args.seccomp_profile)
    if args.profile_dir is not None:
        try:
            probe.make_profile_dir().rmdir()  # the same refusal the run would meet, before anything starts
        except (ValueError, OSError) as exc:
            print(f"login_live_probe: {exc}", file=sys.stderr)
            return 2
    print("engine: " + engine_report(probe.engine, args.engine) + f"; image: {args.image}; profile: "
          f"{'new folder inside ' + args.profile_dir if args.profile_dir else 'volume'}")
    if args.diagnose:
        looser = [("as the service has it", ()), ("seccomp=unconfined", ("--security-opt", "seccomp=unconfined")),
                  ("apparmor=unconfined", ("--security-opt", "apparmor=unconfined")),
                  ("seccomp and apparmor unconfined", ("--security-opt", "seccomp=unconfined", "--security-opt", "apparmor=unconfined"))]
        for label, flags in looser:
            print(f"--- {label}")
            _, text = probe.run(extra=flags, mode=("--syscalls",))
            print(text, end="" if text.endswith("\n") else "\n")
        return 0
    code, output = probe.run()
    print(output, end="" if output.endswith("\n") else "\n")
    failed = code != 0 or bool(lines(output, "FAIL")) or "RESULT [probe] OK" not in output
    if args.controls:
        print("--- control 1: the managed policy covered by an empty one (the profile must NOT stay clean)")
        code1, out1 = probe.run(cover_policy=True)
        print(out1, end="" if out1.endswith("\n") else "\n")
        leaked = [line for line in lines(out1, "FAIL") if "[webdata]" in line or "[logindata]" in line or "[marker]" in line]
        if leaked:
            print("PASS [control-policy] without the policy the browser keeps something of the sign-in: the policy is what keeps it clean")
        else:
            print("INFO [control-policy] without the policy nothing was kept either in this run: the policy is not proven necessary here")
        print("--- control 2: without SYS_CHROOT (the sandbox must not start)")
        code2, out2 = probe.run(without_chroot=True)
        print(out2, end="" if out2.endswith("\n") else "\n")
        if "FAIL" in out2 or code2 == 124:
            failed = True
    print("RESULT: FAILED" if failed else "RESULT: OK")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
