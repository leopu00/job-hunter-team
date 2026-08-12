#!/usr/bin/env python3
"""Census fail-closed dei branch remoti e delle worktree — [BRANCH-LIFECYCLE-CLEANUP].

Non cancella niente, mai. Produce un verdetto leggibile e lascia la decisione
all'integratore: un branch con commit unici non si elimina senza decisione
esplicita merge/abbandono.

Segnala tre cose DISTINTE, che è facile confondere e costoso confondere:

  1. ref remoti già antenati della base — il merge è fatto, il ref è rimasto;
  2. ref con commit unici non integrati — merge-ready oppure abbandonati;
  3. worktree registrate senza sessione.

Perché tenerle separate: `origin/dev2` sta in (1) mentre la sua worktree è
VIVA e ci lavora una sessione. Chi legge «ref integrato» come «roba morta»
cancella il ramo sotto i piedi di chi ci sta scrivendo. Per questo un ref
integrato con worktree viva è marcato `hold` e NON è un candidato.

E simmetricamente `origin/game` porta 30 commit unici e non va toccata
(T-018): sta fra i protetti, non fra le abbandonate. È il caso che dimostra
perché «è vecchia» non è un criterio.

Fail-closed: quando non riesce a stabilire in che categoria sta qualcosa lo
mette fra i DA GUARDARE e esce 1. Non tace e non indovina.

Uso:
  python3 scripts/branch_census.py                 # report testuale
  python3 scripts/branch_census.py --json          # output strutturato
  python3 scripts/branch_census.py --base origin/main
  python3 scripts/branch_census.py --sessions dev1,dev2   # sessioni iniettate
  python3 scripts/branch_census.py --no-session-check     # salta la sezione 3
  python3 scripts/branch_census.py --strict        # esce 3 se ci sono candidati

Lancialo DOPO un `git fetch --prune`: legge i ref locali di tracking, quindi
su una copia stantia misura il passato. Il report stampa data e sha della base
proprio per rendere visibile quanto è vecchia la fotografia.

Codici di uscita:
  0  census completo, tutto classificato
  1  fail-closed: almeno un elemento non classificato (DA GUARDARE)
  2  il census non è potuto girare (non è un repo git, base assente)
  3  solo con --strict: nessun ignoto ma ci sono candidati da smaltire
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import PurePath

DEFAULT_BASE = "origin/master"
DEFAULT_REMOTE = "origin"

# Branch a vita lunga: non sono scorie di un merge e non si propongono MAI per
# la cancellazione, nemmeno quando risultano antenati della base.
#   master     — la base stessa
#   production — ramo di rilascio
#   game       — 30 commit unici, congelata per T-018
DEFAULT_PROTECTED = ("master", "production", "game")

INTEGRATED = "integrated"
UNIQUE = "unique"
PROTECTED = "protected"
UNKNOWN = "unknown"

SESSION_LIVE = "live"
SESSION_ABSENT = "absent"
SESSION_UNKNOWN = "unknown"
SESSION_SKIPPED = "skipped"

# Stato di un ref rispetto al remote VERO, non ai ref di tracking locali.
# Serve perché il census legge `refs/remotes/*`, che è una fotografia: senza
# `git fetch --prune` continua a vedere branch già cancellati su origin e li
# propone per la cancellazione. È successo al primo giro reale — 14 candidati
# annunciati, 7 dei quali fantasmi già rimossi dall'auto-delete di GitHub.
REMOTE_CONFIRMED = "confirmed"   # esiste su origin, allo stesso sha del tracking
REMOTE_STALE = "stale"           # non esiste più su origin: tracking stantio
REMOTE_DRIFTED = "drifted"       # esiste ma a uno sha diverso: la mia foto è vecchia
REMOTE_UNVERIFIED = "unverified"  # non ho potuto chiedere a origin

# Il probe delle sessioni: tmux gira DENTRO WSL. `wsl.exe -e bash -lc` passa
# per una shell di login, che è la forma che trova tmux sul PATH; `wsl.exe --
# tmux ls` dipende dal PATH di default della distro e su alcune torna vuoto.
TMUX_PROBE = ("wsl.exe", "-e", "bash", "-lc", "tmux ls")
TMUX_NO_SERVER = ("no server running", "error connecting to")


class CensusError(RuntimeError):
    """Il census non è potuto girare affatto (exit 2)."""


@dataclass(frozen=True)
class RefFacts:
    """Fatti grezzi su un ref remoto. `None` = git non ha saputo dirlo."""

    name: str
    is_ancestor: bool | None
    unique_commits: int | None
    last_commit_date: str | None = None
    error: str | None = None
    # Sha del ref di tracking: serve a scoprire se il remote è andato avanti
    # sotto di noi, cioè se «0 commit unici» parla di uno sha superato.
    tracking_sha: str | None = None


@dataclass(frozen=True)
class WorktreeFacts:
    """Fatti grezzi su una worktree registrata."""

    path: str
    branch: str | None
    is_main: bool
    prunable: str | None = None


@dataclass
class RefVerdict:
    name: str
    branch: str
    category: str
    reason: str
    unique_commits: int | None
    last_commit_date: str | None
    worktree_session: str | None
    candidate: bool
    remote_status: str = REMOTE_UNVERIFIED
    remote_note: str = ""


@dataclass
class WorktreeVerdict:
    path: str
    branch: str | None
    name: str
    is_main: bool
    session: str
    reason: str
    branch_integrated: bool | None = None


@dataclass
class Census:
    base: str
    base_sha: str
    base_date: str
    refs: list[RefVerdict] = field(default_factory=list)
    worktrees: list[WorktreeVerdict] = field(default_factory=list)
    session_probe: str = SESSION_UNKNOWN
    session_probe_detail: str = ""
    remote_probe: str = REMOTE_UNVERIFIED
    remote_probe_detail: str = ""
    trusting_tracking: bool = False

    @property
    def integrated(self) -> list[RefVerdict]:
        return [r for r in self.refs if r.category == INTEGRATED]

    @property
    def with_unique(self) -> list[RefVerdict]:
        return [r for r in self.refs if r.category == UNIQUE]

    @property
    def protected(self) -> list[RefVerdict]:
        return [r for r in self.refs if r.category == PROTECTED]

    @property
    def unknown_refs(self) -> list[RefVerdict]:
        return [r for r in self.refs if r.category == UNKNOWN]

    @property
    def worktrees_without_session(self) -> list[WorktreeVerdict]:
        return [w for w in self.worktrees if w.session == SESSION_ABSENT]

    @property
    def unknown_worktrees(self) -> list[WorktreeVerdict]:
        return [w for w in self.worktrees if w.session == SESSION_UNKNOWN]

    @property
    def candidates(self) -> list[RefVerdict]:
        return [r for r in self.refs if r.candidate]

    @property
    def suspect_refs(self) -> list[RefVerdict]:
        """Ref la cui foto locale non combacia col remote, o non verificata.

        Non è una categoria di ciclo di vita: è un dubbio sui dati. Un ref qui
        non si tocca, perché la sua classificazione parla di uno sha che su
        origin potrebbe non esistere più o non essere più la punta.
        """
        if self.trusting_tracking:
            return []
        return [
            r for r in self.refs
            if r.category != UNKNOWN
            and r.remote_status != REMOTE_CONFIRMED
        ]

    @property
    def needs_a_look(self) -> int:
        return (
            len(self.unknown_refs)
            + len(self.suspect_refs)
            + len(self.unknown_worktrees)
        )


# ── Nucleo puro: classificazione ──────────────────────────────────────────


def strip_remote(ref_name: str, remote: str = DEFAULT_REMOTE) -> str:
    prefix = f"{remote}/"
    return ref_name[len(prefix):] if ref_name.startswith(prefix) else ref_name


def worktree_name(facts: WorktreeFacts) -> str:
    """Nome con cui una worktree si fa riconoscere da una sessione.

    La convenzione è «una sessione per worktree, stesso nome della cartella».
    Non è imposta da niente, quindi il match accetta anche il nome del branch.
    """
    return PurePath(facts.path.replace("\\", "/")).name or facts.path


def _commits(n: int) -> str:
    return "1 commit unico" if n == 1 else f"{n} commit unici"


def classify_ref(
    facts: RefFacts,
    protected: tuple[str, ...] = DEFAULT_PROTECTED,
    remote: str = DEFAULT_REMOTE,
) -> tuple[str, str]:
    """Categoria di un ref remoto, con la ragione in chiaro."""
    branch = strip_remote(facts.name, remote)
    if facts.error:
        return UNKNOWN, facts.error
    if facts.is_ancestor is None or facts.unique_commits is None:
        return UNKNOWN, "git non ha saputo dire antenato e/o commit unici"
    if branch in protected:
        if facts.unique_commits:
            return PROTECTED, (
                f"protetta, e porta {_commits(facts.unique_commits)}: "
                "non è una branch morta"
            )
        return PROTECTED, "protetta: ramo a vita lunga, non scoria di un merge"
    if facts.is_ancestor and facts.unique_commits == 0:
        return INTEGRATED, "merge fatto, ref rimasto"
    if not facts.is_ancestor and facts.unique_commits > 0:
        integrated = "non integrato" if facts.unique_commits == 1 else "non integrati"
        return UNIQUE, (
            f"{_commits(facts.unique_commits)} {integrated}: "
            "merge-ready o abbandonata, serve una decisione"
        )
    # Le due sonde si contraddicono: se i commit unici sono 0 il ref È un
    # antenato, e viceversa. Non inventiamo quale delle due creda.
    return UNKNOWN, (
        f"segnali incoerenti: antenato={facts.is_ancestor}, "
        f"commit unici={facts.unique_commits}"
    )


def classify_worktree(
    facts: WorktreeFacts,
    sessions: frozenset[str] | None,
    integrated_branches: frozenset[str] = frozenset(),
    unknown_label: str = SESSION_UNKNOWN,
) -> WorktreeVerdict:
    """Stato della sessione di una worktree. `sessions=None` = non accertato.

    `unknown_label` distingue le due ragioni per cui non è accertato: il probe
    è fallito (`unknown`, fail-closed, fa uscire 1) oppure l'operatore ha
    chiesto di saltare la sezione (`skipped`, che non è un guasto). In entrambi
    i casi la worktree non viene dichiarata né viva né abbandonata.
    """
    name = worktree_name(facts)
    integrated = facts.branch in integrated_branches if facts.branch else None
    if facts.prunable:
        # git stesso dice che la worktree non è più sul disco: è il segnale più
        # forte di «registrata e abbandonata», e non dipende da tmux.
        return WorktreeVerdict(
            facts.path, facts.branch, name, facts.is_main, SESSION_ABSENT,
            f"git la dà prunable: {facts.prunable}", integrated,
        )
    if sessions is None:
        reason = (
            "sezione 3 saltata su richiesta"
            if unknown_label == SESSION_SKIPPED
            else "sessioni non accertabili: non affermo né viva né abbandonata"
        )
        return WorktreeVerdict(
            facts.path, facts.branch, name, facts.is_main, unknown_label,
            reason, integrated,
        )
    known = {name}
    if facts.branch:
        known.add(facts.branch)
    if known & sessions:
        return WorktreeVerdict(
            facts.path, facts.branch, name, facts.is_main, SESSION_LIVE,
            "sessione presente", integrated,
        )
    if facts.is_main:
        return WorktreeVerdict(
            facts.path, facts.branch, name, facts.is_main, SESSION_ABSENT,
            "nessuna sessione — ma è la worktree principale, non si rimuove",
            integrated,
        )
    return WorktreeVerdict(
        facts.path, facts.branch, name, facts.is_main, SESSION_ABSENT,
        "nessuna sessione con questo nome", integrated,
    )


def remote_status(
    tracking_sha: str | None,
    remote_refs: dict[str, str] | None,
    branch: str,
) -> tuple[str, str]:
    """Stato del ref sul remote vero. `remote_refs=None` = non ho potuto chiedere."""
    if remote_refs is None:
        return REMOTE_UNVERIFIED, "esistenza su origin non verificata"
    live = remote_refs.get(branch)
    if live is None:
        return REMOTE_STALE, (
            "non esiste più su origin: ref di tracking stantio, "
            "fai `git fetch --prune`"
        )
    if tracking_sha and not (
        live.startswith(tracking_sha) or tracking_sha.startswith(live)
    ):
        return REMOTE_DRIFTED, (
            f"su origin è a {live[:10]}, in locale a {tracking_sha[:10]}: "
            "la classificazione parla di uno sha superato"
        )
    return REMOTE_CONFIRMED, ""


def ref_is_candidate(
    category: str,
    session_state: str | None,
    remote: str = REMOTE_CONFIRMED,
    trust_tracking: bool = False,
) -> bool:
    """Un ref si propone per la cancellazione solo se integrato E libero E vivo.

    Tre gate, e ognuno risponde a un modo diverso di sbagliare:
      * `category` — solo un ref già integrato è una scoria;
      * `session_state` — `None` = nessuna worktree; viva, ignota o non
        controllata ⇒ si tiene, perché il dubbio non autorizza niente;
      * `remote` — deve essere confermato presente su origin allo stesso sha.
        Senza questo gate il census proponeva di cancellare ref già cancellati,
        annunciandoli come lavoro da fare.

    `trust_tracking` è l'unica deroga, e va chiesta a mano (`--no-remote-check`):
    l'operatore dichiara di accettare i propri ref di tracking come autorità.
    """
    if category != INTEGRATED:
        return False
    if session_state is not None and session_state != SESSION_ABSENT:
        return False
    if not trust_tracking and remote != REMOTE_CONFIRMED:
        return False
    return True


def build_census(
    base: str,
    base_sha: str,
    base_date: str,
    ref_facts: list[RefFacts],
    worktree_facts: list[WorktreeFacts],
    sessions: frozenset[str] | None,
    *,
    protected: tuple[str, ...] = DEFAULT_PROTECTED,
    remote: str = DEFAULT_REMOTE,
    session_probe: str = SESSION_UNKNOWN,
    session_probe_detail: str = "",
    unknown_session_label: str = SESSION_UNKNOWN,
    remote_refs: dict[str, str] | None = None,
    remote_probe: str = REMOTE_UNVERIFIED,
    remote_probe_detail: str = "",
    trust_tracking: bool = False,
) -> Census:
    """Compone il verdetto. Nessun I/O: è il pezzo che i test guidano."""
    census = Census(base, base_sha, base_date, session_probe=session_probe,
                    session_probe_detail=session_probe_detail,
                    remote_probe=remote_probe,
                    remote_probe_detail=remote_probe_detail,
                    trusting_tracking=trust_tracking)

    categories = {}
    for facts in ref_facts:
        categories[facts.name] = classify_ref(facts, protected, remote)
    integrated_branches = frozenset(
        strip_remote(name, remote)
        for name, (category, _) in categories.items()
        if category == INTEGRATED
    )

    for facts in worktree_facts:
        census.worktrees.append(
            classify_worktree(
                facts, sessions, integrated_branches, unknown_session_label
            )
        )
    # Una worktree per branch: la mappa serve a tenere il ref e la sua worktree
    # legati, che è tutto il punto della distinzione fra sezione 1 e sezione 3.
    by_branch: dict[str, str] = {}
    for verdict in census.worktrees:
        if verdict.branch:
            by_branch[verdict.branch] = verdict.session

    for facts in ref_facts:
        category, reason = categories[facts.name]
        branch = strip_remote(facts.name, remote)
        session_state = by_branch.get(branch)
        candidate = ref_is_candidate(category, session_state)
        if category == INTEGRATED and not candidate:
            reason = f"{reason} — hold: worktree {session_state}"
        census.refs.append(
            RefVerdict(
                name=facts.name,
                branch=branch,
                category=category,
                reason=reason,
                unique_commits=facts.unique_commits,
                last_commit_date=facts.last_commit_date,
                worktree_session=session_state,
                candidate=candidate,
            )
        )
    census.refs.sort(key=lambda r: r.name)
    return census


# ── Raccolta: git ─────────────────────────────────────────────────────────


def _git(args: list[str], cwd: str | None) -> tuple[int, str]:
    try:
        done = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True,
            encoding="utf-8", errors="replace",
        )
    except OSError as exc:
        raise CensusError(f"git non eseguibile: {exc}") from exc
    return done.returncode, (done.stdout or "").strip()


def resolve_base(base: str, cwd: str | None) -> tuple[str, str]:
    code, sha = _git(["rev-parse", "--verify", f"{base}^{{commit}}"], cwd)
    if code != 0 or not sha:
        raise CensusError(
            f"la base '{base}' non esiste in questa copia: fai `git fetch` "
            "oppure passa --base"
        )
    _, date = _git(["log", "-1", "--format=%ad", "--date=short", base], cwd)
    return sha[:10], date


def gather_refs(base: str, cwd: str | None, remote: str) -> list[RefFacts]:
    # `%(symref)` smaschera i puntatori simbolici. Serve: `refs/remotes/origin/
    # HEAD` viene accorciato da `refname:short` a `origin` — non a `origin/HEAD`
    # — quindi filtrare per nome lo lascia passare, e un census che propone di
    # cancellare `origin` è peggio che inutile.
    code, out = _git(
        [
            "for-each-ref",
            "--format=%(refname:short)%09%(symref)",
            f"refs/remotes/{remote}",
        ],
        cwd,
    )
    if code != 0:
        raise CensusError(f"`git for-each-ref` è fallito: {out}")
    facts = []
    for line in (l for l in out.splitlines() if l.strip()):
        name, _, symref = line.partition("\t")
        name = name.strip()
        if symref.strip():
            continue
        if name in (remote, f"{remote}/HEAD", base):
            continue
        ancestor_code, _ = _git(["merge-base", "--is-ancestor", name, base], cwd)
        # 0 = antenato, 1 = non antenato, altro = git non lo sa (fail-closed).
        is_ancestor: bool | None
        if ancestor_code == 0:
            is_ancestor = True
        elif ancestor_code == 1:
            is_ancestor = False
        else:
            is_ancestor = None
        count_code, count_out = _git(
            ["rev-list", "--count", f"{base}..{name}"], cwd
        )
        unique = int(count_out) if count_code == 0 and count_out.isdigit() else None
        _, date = _git(["log", "-1", "--format=%ad", "--date=short", name], cwd)
        error = None
        if is_ancestor is None or unique is None:
            error = "git non ha risposto su antenato e/o commit unici"
        facts.append(
            RefFacts(name, is_ancestor, unique, date or None, error)
        )
    return facts


def parse_worktree_porcelain(text: str) -> list[WorktreeFacts]:
    """Legge `git worktree list --porcelain`. La prima voce è la principale."""
    blocks: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            if current:
                blocks.append(current)
                current = {}
            continue
        key, _, value = line.partition(" ")
        current[key] = value
    if current:
        blocks.append(current)

    facts = []
    for index, block in enumerate(blocks):
        path = block.get("worktree", "")
        if not path:
            continue
        branch = block.get("branch")
        if branch and branch.startswith("refs/heads/"):
            branch = branch[len("refs/heads/"):]
        facts.append(
            WorktreeFacts(
                path=path,
                branch=branch or None,
                is_main=index == 0,
                prunable=block.get("prunable") or None,
            )
        )
    return facts


def gather_worktrees(cwd: str | None) -> list[WorktreeFacts]:
    code, out = _git(["worktree", "list", "--porcelain"], cwd)
    if code != 0:
        raise CensusError(f"`git worktree list` è fallito: {out}")
    return parse_worktree_porcelain(out)


# ── Raccolta: sessioni ────────────────────────────────────────────────────


def parse_tmux_sessions(text: str) -> frozenset[str]:
    """Nomi di sessione da `tmux ls`.

    Solo il nome: dentro le sessioni girano processi Claude Code
    Windows-native, quindi `pane_current_path` dice `/home/ubuntu` e
    `pane_current_command` dice `init` per tutte. Quei campi non distinguono
    una sessione viva da una vuota, il nome sì.
    """
    names = set()
    for line in text.splitlines():
        name, sep, _ = line.partition(":")
        if sep and name.strip():
            names.add(name.strip())
    return frozenset(names)


def probe_sessions(timeout: float = 20.0) -> tuple[frozenset[str] | None, str, str]:
    """Elenca le sessioni tmux dentro WSL. Ritorna (nomi, stato, dettaglio).

    `None` come primo elemento = non accertabile ⇒ fail-closed. Distinguiamo
    «tmux raggiungibile e zero sessioni» (risposta vera, insieme vuoto) da
    «non ho potuto chiedere» (ignoto): la prima autorizza un verdetto, la
    seconda no.
    """
    if shutil.which(TMUX_PROBE[0]) is None:
        return None, SESSION_UNKNOWN, f"{TMUX_PROBE[0]} non trovato nel PATH"
    try:
        done = subprocess.run(
            list(TMUX_PROBE), capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, SESSION_UNKNOWN, f"probe non eseguibile: {exc}"
    blob = f"{done.stdout}\n{done.stderr}".lower()
    if done.returncode == 0:
        names = parse_tmux_sessions(done.stdout)
        return names, "ok", f"{len(names)} sessioni: {', '.join(sorted(names)) or '—'}"
    if any(marker in blob for marker in TMUX_NO_SERVER):
        return frozenset(), "ok", "tmux raggiungibile, nessuna sessione attiva"
    detail = (done.stderr or done.stdout or "").strip().splitlines()
    return None, SESSION_UNKNOWN, f"probe uscito {done.returncode}: {detail[:1]}"


# ── Resa ──────────────────────────────────────────────────────────────────


def _ref_line(ref: RefVerdict) -> str:
    mark = "→ candidato" if ref.candidate else "  hold" if ref.category == INTEGRATED else ""
    date = ref.last_commit_date or "data ignota"
    return f"    {ref.name:<58} {date}  {ref.reason} {mark}".rstrip()


def render_text(census: Census) -> str:
    out = [
        "CENSUS BRANCH & WORKTREE — [BRANCH-LIFECYCLE-CLEANUP]",
        f"base {census.base} @ {census.base_sha} ({census.base_date})",
        f"sessioni: probe {census.session_probe} — {census.session_probe_detail}",
        "",
        f"1. REF GIÀ ANTENATI DELLA BASE — merge fatto, ref rimasto  [{len(census.integrated)}]",
    ]
    out += [_ref_line(r) for r in census.integrated] or ["    (nessuno)"]
    out += [
        "",
        f"2. REF CON COMMIT UNICI NON INTEGRATI — decisione richiesta  [{len(census.with_unique)}]",
    ]
    out += [_ref_line(r) for r in census.with_unique] or ["    (nessuno)"]
    out += [
        "",
        f"3. WORKTREE SENZA SESSIONE  [{len(census.worktrees_without_session)}]",
    ]
    if census.worktrees_without_session:
        for w in census.worktrees_without_session:
            tag = " [principale]" if w.is_main else ""
            branch = w.branch or "detached"
            out.append(f"    {w.path}{tag}")
            out.append(f"        branch {branch} — {w.reason}")
    else:
        out.append("    (nessuna)")

    out += ["", f"PROTETTI — mai proposti  [{len(census.protected)}]"]
    out += [_ref_line(r) for r in census.protected] or ["    (nessuno)"]

    out += ["", f"DA GUARDARE — non classificati  [{census.needs_a_look}]"]
    if census.needs_a_look:
        for r in census.unknown_refs:
            out.append(f"    ref {r.name}: {r.reason}")
        for w in census.unknown_worktrees:
            out.append(f"    worktree {w.path}: {w.reason}")
    else:
        out.append("    (nessuno)")

    live = sum(1 for w in census.worktrees if w.session == SESSION_LIVE)
    out += [
        "",
        f"Verdetto: {len(census.candidates)} ref proponibili per la cancellazione, "
        f"{len(census.with_unique)} da decidere, "
        f"{len(census.worktrees_without_session)} worktree senza sessione "
        f"({live} vive), {census.needs_a_look} da guardare.",
        "Il census non cancella niente: nessun ref con commit unici si elimina "
        "senza decisione esplicita.",
    ]
    return "\n".join(out)


def render_json(census: Census) -> str:
    payload = {
        "base": census.base,
        "base_sha": census.base_sha,
        "base_date": census.base_date,
        "session_probe": census.session_probe,
        "session_probe_detail": census.session_probe_detail,
        "integrated": [vars(r) for r in census.integrated],
        "unique": [vars(r) for r in census.with_unique],
        "protected": [vars(r) for r in census.protected],
        "unknown_refs": [vars(r) for r in census.unknown_refs],
        "worktrees": [vars(w) for w in census.worktrees],
        "worktrees_without_session": [
            vars(w) for w in census.worktrees_without_session
        ],
        "candidates": [r.name for r in census.candidates],
        "needs_a_look": census.needs_a_look,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def exit_code(census: Census, strict: bool) -> int:
    if census.needs_a_look:
        return 1
    if strict and census.candidates:
        return 3
    return 0


# ── CLI ───────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Census fail-closed di branch remoti e worktree. Non cancella niente.",
    )
    parser.add_argument("--base", default=DEFAULT_BASE,
                        help=f"ref di confronto (default {DEFAULT_BASE})")
    parser.add_argument("--remote", default=DEFAULT_REMOTE)
    parser.add_argument("--repo", default=None, help="directory del repo")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--sessions", default=None,
                        help="lista di sessioni separate da virgola, invece del probe")
    parser.add_argument("--no-session-check", action="store_true",
                        help="salta la sezione 3 invece di indovinarla")
    parser.add_argument("--protected", default=",".join(DEFAULT_PROTECTED),
                        help="branch mai proposti per la cancellazione")
    parser.add_argument("--strict", action="store_true",
                        help="esce 3 se ci sono candidati da smaltire")
    args = parser.parse_args(argv)

    try:
        base_sha, base_date = resolve_base(args.base, args.repo)
        ref_facts = gather_refs(args.base, args.repo, args.remote)
        worktree_facts = gather_worktrees(args.repo)
    except CensusError as exc:
        print(f"census: {exc}", file=sys.stderr)
        return 2

    if args.no_session_check:
        sessions, probe_state, probe_detail = None, SESSION_SKIPPED, (
            "--no-session-check: sezione 3 non valutata"
        )
    elif args.sessions is not None:
        names = frozenset(n.strip() for n in args.sessions.split(",") if n.strip())
        sessions, probe_state, probe_detail = names, "ok", (
            f"iniettate: {', '.join(sorted(names)) or '—'}"
        )
    else:
        sessions, probe_state, probe_detail = probe_sessions()

    census = build_census(
        args.base, base_sha, base_date, ref_facts, worktree_facts, sessions,
        protected=tuple(p.strip() for p in args.protected.split(",") if p.strip()),
        remote=args.remote,
        session_probe=probe_state,
        session_probe_detail=probe_detail,
        # Saltare la sezione è una scelta dell'operatore, non un guasto: le
        # worktree restano «non valutate» e non fanno scattare il fail-closed.
        unknown_session_label=(
            SESSION_SKIPPED if args.no_session_check else SESSION_UNKNOWN
        ),
    )

    print(render_json(census) if args.as_json else render_text(census))
    return exit_code(census, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
