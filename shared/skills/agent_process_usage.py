"""Sample Linux process trees once per refresh; identity includes start ticks.

CPU is the observed tree's delta / wall time / guest CPU count. Processes that
start and exit between samples cannot be measured. RSS includes shared pages.
No host/VM/Windows-bridge usage is included. No shell or process signalling.
"""
import os
from pathlib import Path


def read_processes(root=Path("/proc")):
    out, errors = {}, []
    try:
        paths = list(root.iterdir())
    except OSError:
        return {}, ["observer_process_unavailable"]
    for path in paths:
        if not path.name.isdigit():
            continue
        try:
            fields = (path / "stat").read_text().rsplit(")", 1)[1].split()
            out[int(path.name)] = {
                "parent": int(fields[1]), "start": int(fields[19]),
                "ticks": int(fields[11]) + int(fields[12]), "rss_pages": int(fields[21]),
                "alive": fields[0] not in {"Z", "X"},
            }
        except (FileNotFoundError, ProcessLookupError):
            continue  # A short-lived process ended during this sample.
        except (OSError, ValueError, IndexError):
            errors.append("observer_process_partial")
    return out, sorted(set(errors))


def owned_processes(roots, processes):
    owned = {pid for pid in roots if pid in processes}
    for _ in range(len(processes)):
        added = {pid for pid, value in processes.items() if value["parent"] in owned} - owned
        if not added:
            break
        owned.update(added)
    return owned


class ProcessMeter:
    def __init__(self, hz=None, page=None, cpus=None, memory_bytes=None):
        self.hz = hz or os.sysconf("SC_CLK_TCK")
        self.page = page or os.sysconf("SC_PAGE_SIZE")
        self.cpus = cpus or os.cpu_count() or 1
        self.memory = memory_bytes or os.sysconf("SC_PHYS_PAGES") * self.page
        self.previous, self.at = {}, None

    def sample(self, sessions, processes, at, partial=False):
        result = {}
        elapsed = at - self.at if self.at is not None else None
        for name, session in sessions.items():
            owned = owned_processes(session["pids"], processes)
            alive = {pid for pid in owned if processes[pid]["alive"]}
            comparable = elapsed is not None and elapsed > 0 and bool(alive)
            delta = 0
            for pid in alive:
                value, previous = processes[pid], self.previous.get(pid)
                if previous is None or previous["start"] != value["start"]:
                    comparable = False
                else:
                    delta += max(0, value["ticks"] - previous["ticks"])
            rss = sum(max(0, processes[pid]["rss_pages"]) for pid in alive) * self.page
            result[name] = {
                "pids": sorted(alive), "alive": bool(alive) if not partial else None,
                "cpu_pct": round(delta / self.hz / elapsed / self.cpus * 100, 2)
                if comparable and not partial else None,
                "rss_bytes": rss if alive and not partial else None,
                "rss_pct": round(rss / self.memory * 100, 2) if alive and not partial else None,
                "reason": "observer_process_partial" if partial else
                (None if comparable else "observer_process_warming"),
            }
        self.previous, self.at = processes, at
        return result
