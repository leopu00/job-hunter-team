"""How many workers this machine carries, from measurements and not from a flat constant.

A flat RAM-per-agent figure sizes the team wrong in both directions: too high and a machine with room runs a single
worker, too low and a small one thrashes. The cap here comes from what the machine has and what a session of the harness
costs:

  * RAM: the resident memory of one session of each harness, measured by sampling the processes of a running team, times
    the agents, plus what the system and the fixed agents need. A harness nobody measured keeps a conservative
    ESTIMATE, and the message says so (`MEASURED` below tells which are which).
  * CPU: the cores bound the workers too. A team can fit in RAM and still saturate the processors, and then more workers
    stop adding scored positions. So the cap is also a number of workers per core, and a very high load average halves it.
  * Free RAM right now: little of it stops the cap from growing.
  * Swap counts, at a weight: a session that waits on the network most of the time can sit partly in swap without
    slowing the team, but swap is not RAM, so only part of it is added.
  * A server without a screen (JHT_HOST_TYPE=vps, written by the host preflight) has no browser or desktop of a person
    to keep room for: its reserve is the system and the container runtime only.

Example with made-up round numbers: 8 GiB of RAM, 4 cores, a harness measured at 0.25 GiB per agent. The RAM would
allow (8 - 2) / 0.25 - 5 = 19 workers, the cores allow 4 x 2 = 8, so the cap is 8 and the limit is "cpu". On a 3 GiB machine
the RAM allows 0 and the cap is 1: nothing raises the cap above what the RAM holds.

The measured case behind the pi figures: a VPS with 4 GB (3.7 GiB seen), 2 cores and the 2 GiB of swap the installer
makes. (3.7 + 2 x 0.5 - 1.0) / 0.22 = 16 agents, minus the 5 fixed = 11 workers; the cores allow 2 x 5 = 10: the full
team of tier 15 (5 Scout / 3 Analista / 2 Scorer). Without the swap the RAM allows 7, so the roster is cut and says so.

The per-core factors and the load brake come from a few measured runs: they are the knobs to adjust as more machines
are measured. `capacity()` is pure (a probe in, a dict out) so the behaviour is tested with made-up machines.
"""

import os
import re
from pathlib import Path

GIB = 1024 ** 3
# pi: sampled on four runs of a full team on GLM (5 Scout / 3 Analista / 2 Scorer plus the fixed agents, 13-14 sessions,
# 8 cores / 15.2 GiB): the largest pi process was 0.18 GiB resident (median about 0.165), and the whole team added at most
# 1.8 GiB to the 0.9 GiB the machine used before it started: about 0.14 GiB per session, everything included. The figure
# here is higher, 0.22, because the headless browser a Scout opens now and then is the largest process on the machine
# (0.22-0.25 GiB) and a session has to make room for it.
RAM_GIB_PER_AGENT = {"codex": 0.22, "claude": 0.6, "kimi": 0.6, "pi": 0.22}
MEASURED = frozenset({"codex", "pi"})
UNKNOWN_HARNESS_GIB = 0.6
# What the machine keeps for itself. A local computer: the system, the container runtime and the browser and desktop of
# the person who works on it. A server without a screen: the system and the runtime only, measured at 0.9 GiB before the
# team started on the four runs above.
RAM_RESERVED_GIB = {"local": 2.0, "vps": 1.0}
# A GiB of swap counts as half a GiB of RAM. A choice, not a measure: the runs above did not sample the swap. Sessions
# that wait on the network most of the time are what can live partly in swap without slowing the team.
SWAP_WEIGHT = 0.5
FIXED_AGENTS = 5               # Capitano, Sentinella, Assistente, Mentor, Dottore are already running
# Workers per core. codex: set from one measured run. pi: the same four runs peaked at a load of 2.6 on 8 cores with the
# full team: a pi session waits on the model's answer most of the time, so 5 per core still leaves the cores half idle.
WORKERS_PER_CORE = {"pi": 5.0}
DEFAULT_WORKERS_PER_CORE = 2.0
LOAD_BRAKE_PER_CORE = 8.0      # very high load per core: the cap is halved
LOW_AVAILABLE_GIB = 0.75       # less than this free right now: no room to grow
USEFUL_PIPELINE = 3            # one Scout, one Analista, one Scorer: the cap does not grow past it while RAM is short

_PROVIDER_HARNESS = {"openai": "codex", "codex": "codex", "claude": "claude", "anthropic": "claude",
                     "kimi": "kimi", "moonshot": "kimi", "glm": "pi", "zai": "pi", "z.ai": "pi"}


def _roles_on_pi(env):
    return any(name.startswith("JHT_AGENT_HARNESS_") and str(value).strip().lower() == "pi"
               for name, value in (env or {}).items())


def _config_on_pi(config):
    return isinstance(config, dict) and str(config.get("harness") or "").strip().lower() == "pi"


def harness_of(provider, env=None, config=None):
    """The harness that sizes the team. When the config puts the team on pi (`harness`, chosen in `jht setup`) every role
    runs pi and no other CLI runs: the team is sized as pi. GLM only runs on pi. When only some roles are put on pi
    (JHT_AGENT_HARNESS_<ROLE>=pi, see .launcher/spawn-harness.sh) the others keep the provider's CLI, so the cap holds the
    heavier of the two sessions. `env` defaults to the environment of the process; `config` is the parsed
    jht.config.json, or None."""
    base = _PROVIDER_HARNESS.get(str(provider or "").strip().lower())
    if _config_on_pi(config):
        return "pi"
    if _roles_on_pi(os.environ if env is None else env):
        if base is None or RAM_GIB_PER_AGENT["pi"] >= RAM_GIB_PER_AGENT.get(base, UNKNOWN_HARNESS_GIB):
            return "pi"
    return base


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
    total = avail = swap = None
    try:
        text = (proc / "meminfo").read_text()
        total, avail = _meminfo_gib(text, "MemTotal"), _meminfo_gib(text, "MemAvailable")
        swap = _meminfo_gib(text, "SwapTotal")
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
    if mem_limit is not None:
        swap = None    # a container with a memory limit: its swap is not the machine's to count
    host_type = "vps" if str(os.environ.get("JHT_HOST_TYPE") or "").strip().lower() == "vps" else "local"
    return {"ram_total_gib": total, "ram_avail_gib": avail, "cores": cores, "load5": load5, "swap_total_gib": swap,
            "host_type": host_type}


def capacity(probe, harness=None):
    """The cap on workers and why. {"cap": None, ...} when the RAM is not known (no cap, as before).

    The RAM sets the ceiling and nothing raises the cap above it: a machine that cannot hold the fixed agents plus a
    worker gets 1, as before. The cores can lower it further, then the load and the free RAM brake it."""
    total = probe.get("ram_total_gib")
    if total is None:
        return {"cap": None, "limit": "unknown", "message": "Host capacity could not be measured: no cap applied."}
    per = RAM_GIB_PER_AGENT.get(harness, UNKNOWN_HARNESS_GIB)
    measured = harness in MEASURED
    reserved = RAM_RESERVED_GIB["vps" if probe.get("host_type") == "vps" else "local"]
    swap = probe.get("swap_total_gib") or 0.0
    ram_cap = int(max(0.0, total + swap * SWAP_WEIGHT - reserved) / per + 1e-9) - FIXED_AGENTS
    cores = probe.get("cores")
    cpu_cap = int(cores * WORKERS_PER_CORE.get(harness, DEFAULT_WORKERS_PER_CORE)) if cores else None
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
    swap = probe.get("swap_total_gib") or 0.0
    machine = "%.1f GiB RAM%s%s%s" % (probe["ram_total_gib"], (" + %.1f GiB swap" % swap) if swap else "",
                                      (", %g cores" % cores) if cores else "",
                                      ", no screen" if probe.get("host_type") == "vps" else "")
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
    return "This machine (%s) carries %d worker%s: %s." % (machine, cap, "" if cap == 1 else "s", why)
