"""How many workers this machine carries, from measurements and not from a flat constant.

The old cap divided the RAM by 0.6 GiB per agent. A Windows PC with a 5.9 GiB VM came out at 1 worker, and one worker
cannot make 20 scored positions in 30 minutes. What was measured (a Kimi team of 13 sessions on that VM, 4 vCPU, 08/11):

  * RAM: a Codex session is two processes of ~107 MiB each (89-114 over 94 samples), ~0.22 GiB per session; 13 sessions
    held 2.8 GiB and the VM kept 3-4 GiB free, no OOM. The 0.6 GiB was ~3x too high.
  * CPU: the same run saturated the host (100%) and the VM load reached 20-40 on 4 vCPU, yet it produced ~26 positions
    and 7 scores an hour against ~3 positions and no score with the cap at 1. So the cores, not the RAM, are the limit,
    and the cap has to look at them.

Only Codex has a measured RSS. For the other harnesses the old 0.6 GiB stays as an ESTIMATE and is reported as such until
somebody measures them (`MEASURED` below says which are which). The CPU factor and the load brake are calibrated on the one
4-vCPU run above: they are the place to adjust when more machines are measured.

`capacity()` is pure (a probe in, a dict out) so the behaviour is tested with made-up RAM and cores.
"""

import os
import re
from pathlib import Path

GIB = 1024 ** 3
RAM_GIB_PER_AGENT = {"codex": 0.22, "claude": 0.6, "kimi": 0.6, "pi": 0.6}
MEASURED = frozenset({"codex"})
UNKNOWN_HARNESS_GIB = 0.6
RAM_RESERVED_GIB = 2.0         # the system, the container runtime, the browser of a person who works on this machine
FIXED_AGENTS = 5               # Capitano, Sentinella, Assistente, Mentor, Dottore are already running
WORKERS_PER_CORE = 2.0         # 13 sessions on 4 vCPU saturated the host and still produced; 2 workers per core
LOAD_BRAKE_PER_CORE = 8.0      # the run above peaked at ~9 per core; beyond 8 the cap is halved
LOW_AVAILABLE_GIB = 0.75       # less than this free right now: no room to grow
USEFUL_PIPELINE = 3            # one Scout, one Analista, one Scorer: the cap does not grow past it while RAM is short

_PROVIDER_HARNESS = {"openai": "codex", "codex": "codex", "claude": "claude", "anthropic": "claude",
                     "kimi": "kimi", "moonshot": "kimi"}


def harness_of(provider):
    return _PROVIDER_HARNESS.get(str(provider or "").strip().lower())


def _meminfo_gib(text, key):
    found = re.search(r"^%s:\s+(\d+)\s*kB" % key, text, re.MULTILINE)
    return int(found.group(1)) * 1024 / GIB if found else None


def _cgroup_limits(root):
    """Memory and CPU limits of this container (cgroup v2), or None for each that is not set."""
    mem = cpu = None
    try:
        raw = (root / "memory.max").read_text().strip()
        mem = int(raw) / GIB if raw.isdigit() else None
    except (OSError, ValueError):
        pass
    try:
        quota, period = (root / "cpu.max").read_text().split()[:2]
        cpu = int(quota) / int(period) if quota.isdigit() and int(period) > 0 else None
    except (OSError, ValueError):
        pass
    return mem, cpu


def read_probe(proc=Path("/proc"), cgroup=Path("/sys/fs/cgroup")):
    """What this machine has right now. Missing facts are None (the caller then has no cap, as before)."""
    total = avail = None
    try:
        text = (proc / "meminfo").read_text()
        total, avail = _meminfo_gib(text, "MemTotal"), _meminfo_gib(text, "MemAvailable")
    except OSError:
        pass
    if total is None:
        try:
            total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / GIB
        except (ValueError, OSError, AttributeError):
            total = None
    cores = float(os.cpu_count() or 0) or None
    mem_limit, cpu_limit = _cgroup_limits(cgroup)
    if mem_limit is not None and (total is None or mem_limit < total):
        total = mem_limit
        avail = min(avail, mem_limit) if avail is not None else None
    if cpu_limit is not None and (cores is None or cpu_limit < cores):
        cores = cpu_limit
    try:
        load5 = os.getloadavg()[1]
    except (OSError, AttributeError):
        load5 = None
    return {"ram_total_gib": total, "ram_avail_gib": avail, "cores": cores, "load5": load5}


def capacity(probe, harness=None):
    """The cap on workers and why. {"cap": None, ...} when the RAM is not known (no cap, as before).

    The RAM sets the ceiling and nothing raises the cap above it: a machine that cannot hold the fixed agents plus a
    worker gets 1, as before. The cores can lower it further, then the load and the free RAM brake it."""
    total = probe.get("ram_total_gib")
    if total is None:
        return {"cap": None, "limit": "unknown", "message": "Host capacity could not be measured: no cap applied."}
    per = RAM_GIB_PER_AGENT.get(harness, UNKNOWN_HARNESS_GIB)
    measured = harness in MEASURED
    ram_cap = int(max(0.0, total - RAM_RESERVED_GIB) / per) - FIXED_AGENTS
    cores = probe.get("cores")
    cpu_cap = int(cores * WORKERS_PER_CORE) if cores else None
    cap, limit = max(1, ram_cap), "ram"
    if cpu_cap is not None and max(1, cpu_cap) < cap:
        cap, limit = max(1, cpu_cap), "cpu"
    load5 = probe.get("load5")
    if cores and load5 is not None and load5 > cores * LOAD_BRAKE_PER_CORE and cap > 1:
        cap, limit = max(1, cap // 2), "load"
    avail = probe.get("ram_avail_gib")
    if avail is not None and avail < LOW_AVAILABLE_GIB and cap > USEFUL_PIPELINE:
        cap, limit = USEFUL_PIPELINE, "free-ram"
    return {"cap": cap, "limit": limit, "ram_cap": ram_cap, "cpu_cap": cpu_cap, "ram_per_agent_gib": per,
            "ram_per_agent_measured": measured, "ram_total_gib": round(total, 2), "cores": cores,
            "message": _message(cap, limit, probe, per, measured, ram_cap, cpu_cap)}


def _message(cap, limit, probe, per, measured, ram_cap, cpu_cap):
    cores = probe.get("cores")
    machine = "%.1f GiB RAM%s" % (probe["ram_total_gib"], (", %g cores" % cores) if cores else "")
    ram = "%.2f GiB per agent (%s)" % (per, "measured" if measured else "estimated, not measured")
    if limit == "ram" and cap == 1 and ram_cap < 1:
        why = "this machine is too small for a pipeline (%s): one worker at a time" % ram
    else:
        why = {
            "ram": "the RAM is the limit (%s)" % ram,
            "cpu": "the cores are the limit (%d workers on %g cores; RAM alone would allow %d)"
                   % (cpu_cap or 0, cores or 0, ram_cap),
            "load": "the machine is overloaded (load %.1f on %g cores): the cap is halved"
                    % (probe.get("load5") or 0, cores or 0),
            "free-ram": "only %.2f GiB of RAM are free right now: no room to grow" % (probe.get("ram_avail_gib") or 0),
        }[limit]
    return "This machine (%s) carries %d workers: %s." % (machine, cap, why)
