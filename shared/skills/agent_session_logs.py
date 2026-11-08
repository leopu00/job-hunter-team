"""One bounded acquisition of session logs for activity and current identity.

The state reader supplies its existing parsers and clock rules. The observer
uses the same selection; identity always comes from the winning CLI's log.
"""
import hashlib
from datetime import datetime

try:
    from agent_session_identity import identity
except ModuleNotFoundError:
    from shared.skills.agent_session_identity import identity


def codex_index(state, src, since, errors=None):
    """One shared inventory per observer batch, not 400 log headers per agent."""
    out = {}
    for path in state._newer(src.codex.glob("*/*/*/rollout-*.jsonl"), since)[:state.CODEX_ROLLOUTS_SCANNED]:
        try:
            with path.open(encoding="utf-8", errors="replace") as handle:
                head = next(state._objects([handle.readline(65536)]), {})
            payload = head.get("payload")
            cwd = payload.get("cwd") if isinstance(payload, dict) else None
            if isinstance(cwd, str) and cwd not in out:
                out[cwd] = (path, path.stat().st_mtime)
        except OSError:
            if errors is not None:
                errors.append("observer_session_logs_unavailable")
            continue
    return out


def inspect_session(state, src, cwd, created, include_identity=True, index=None, errors=None):
    since = created - state.CLOCK_SLACK_S
    candidates = []
    listed = False
    counts = [0, 0]

    def take(provider, path, parser):
        lines = state.tail_lines(path)
        parsed = parser(lines)
        counts[0] += parsed.lines
        counts[1] += parsed.recognised
        if parsed.events:
            candidates.append((parsed, identity(provider, lines, since, state) if include_identity else None))

    try:
        root = src.claude / state.claude_slug(cwd)
        if src.claude.is_dir():
            listed = True
        if root.is_dir():
            for path in state._newer(root.glob("*.jsonl"), since)[:2]:
                take("claude", path, state.parse_claude)
    except OSError:
        if errors is not None:
            errors.append("observer_session_logs_unavailable")
    try:
        if src.codex.is_dir():
            listed = True
            if index is not None:
                selected = index.get(cwd)
                if selected and selected[1] >= since:
                    take("codex", selected[0], state.parse_codex)
            else:
                day0 = datetime.fromtimestamp(since).strftime("%Y/%m/%d")
                files = [p for p in src.codex.glob("*/*/*/rollout-*.jsonl")
                         if "/".join(p.parts[-4:-1]) >= day0]
                for path in state._newer(files, since)[:state.CODEX_ROLLOUTS_SCANNED]:
                    with path.open(encoding="utf-8", errors="replace") as handle:
                        head = next(state._objects(handle), {})
                    if (head.get("payload") or {}).get("cwd") != cwd:
                        continue
                    take("codex", path, state.parse_codex)
                    break
    except OSError:
        if errors is not None:
            errors.append("observer_session_logs_unavailable")
    try:
        if src.kimi.is_dir():
            listed = True
            root = src.kimi / hashlib.md5(cwd.encode()).hexdigest()
            if root.is_dir():
                failures = []
                for log in state._newer(src.kimi_logs.glob("kimi.*.log"), since)[:2]:
                    failures += state.kimi_log_failures(state.tail_lines(log))
                for wire in state._newer(root.glob("*/wire.jsonl"), since)[:1]:
                    take("kimi", wire, lambda lines: state.parse_kimi(lines, wire.parent.name, failures))
    except OSError:
        if errors is not None:
            errors.append("observer_session_logs_unavailable")
    if not candidates:
        return [], listed, counts[0] >= 5 and counts[1] == 0, None, None
    best, current = max(candidates, key=lambda p: p[0].events[-1].ts)
    context = best.context if best.context and best.context["at"] >= since else None
    return best.events, listed, False, context, current
