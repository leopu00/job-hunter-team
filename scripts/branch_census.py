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
  python3 scripts/branch_census.py --no-remote-check      # non interroga origin
  python3 scripts/branch_census.py --strict        # esce 3 se ci sono candidati

Un ref è proponibile solo se `git ls-remote` conferma che esiste ancora su
origin, allo stesso sha del ref di tracking. Senza quel controllo il census
propone di cancellare roba già cancellata: al primo giro reale ha annunciato
14 candidati di cui 7 fantasmi, rimossi dall'auto-delete di GitHub al merge
del PR. Un tracking stantio (`stale`) o superato (`drifted`) va fra i DA
GUARDARE, non fra i candidati, perché la sua classificazione parla di uno sha
che su origin non è più la punta — o non c'è più.

`--no-remote-check` è la deroga esplicita: l'operatore dichiara di accettare i
propri ref di tracking come autorità, e il report lo scrive in testa.

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
# Esito della ricerca di un claim, cioè della domanda «questo ticket lo sta già
# facendo qualcun altro?». Il protocollo del 2026-08-12 vuole che un ticket si
# dichiari con un commit `WIP(<scope>): ... (<ID>)` pushato PRIMA di scrivere
# codice, così due macchine sullo stesso repo non lo prendono entrambe.
CLAIM_FREE = "free"        # nessun commit lo nomina
CLAIM_MINE = "mine"        # solo sul mio branch, lavoro in corso mio
CLAIM_TAKEN = "taken"      # su un branch altrui e non ancora integrato: FERMATI
CLAIM_DONE = "done"        # tutti i commit che lo nominano sono già nella base
CLAIM_UNKNOWN = "unknown"  # la ricerca non è accertabile: non dico «libero»

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


@dataclass(frozen=True)
class ClaimFacts:
    """Un commit che nomina l'ID del ticket, e dove si trova."""

    sha: str
    date: str
    subject: str
    branches: tuple[str, ...]
    # `True` = già raggiungibile dalla base, quindi il ticket risulta
    # integrato; `None` = git non ha saputo dirlo (fail-closed).
    in_base: bool | None


@dataclass
class ClaimReport:
    ticket: str
    verdict: str
    reason: str
    own_branch: str
    claims: list[ClaimFacts] = field(default_factory=list)
    other_branches: tuple[str, ...] = ()

    @property
    def blocked(self) -> bool:
        """Se True, il protocollo dice di fermarsi e chiedere."""
        return self.verdict in (CLAIM_TAKEN, CLAIM_UNKNOWN)


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


def classify_claims(
    ticket: str,
    claims: list[ClaimFacts],
    own_branch: str,
    *,
    search_ok: bool = True,
    view_is_current: bool = True,
) -> ClaimReport:
    """Decide se un ticket è libero, mio, di altri, o già fatto.

    Due asimmetrie volute, ed è lì che sta il fail-closed:

    * «non ho trovato niente» vale come *libero* SOLO se la mia copia dei ref
      remoti è allineata. Se un branch su origin è andato avanti dopo l'ultimo
      fetch, un claim può esistere e io non vederlo: allora è `unknown`, non
      `free`. Dire «libero» per ignoranza è il modo in cui due macchine
      finiscono sullo stesso ticket, che è esattamente ciò che il protocollo
      esiste per evitare.
    * «ho trovato un claim» resta valido anche con la copia indietro: trovarlo
      è prova positiva, e una copia stantia non la smentisce.
    """
    report = ClaimReport(ticket=ticket, verdict=CLAIM_UNKNOWN, reason="",
                         own_branch=own_branch, claims=list(claims))
    if not search_ok:
        report.reason = "la ricerca dei claim non è potuta girare"
        return report
    if not claims:
        if not view_is_current:
            report.reason = (
                "nessun claim trovato, ma la copia dei ref remoti è indietro: "
                "fai `git fetch --all --prune` e ripeti"
            )
            return report
        report.verdict = CLAIM_FREE
        report.reason = "nessun commit remoto nomina questo ID"
        return report

    pending = [c for c in claims if c.in_base is not True]
    if any(c.in_base is None for c in pending):
        report.reason = "git non ha saputo dire se i claim sono già nella base"
        return report
    if not pending:
        report.verdict = CLAIM_DONE
        report.reason = (
            f"{len(claims)} commit lo nominano, tutti già integrati nella base: "
            "il ticket risulta fatto"
        )
        return report

    others = tuple(sorted({
        branch
        for claim in pending
        for branch in claim.branches
        if strip_remote(branch) != strip_remote(own_branch)
    }))
    report.other_branches = others
    if others:
        report.verdict = CLAIM_TAKEN
        report.reason = (
            f"claimato su {', '.join(others)}: fermati e chiedi a Leone, "
            "non lavorarci sopra"
        )
        return report
    report.verdict = CLAIM_MINE
    report.reason = f"claimato solo su {own_branch}: è lavoro tuo, prosegui"
    return report


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
        status, note = remote_status(facts.tracking_sha, remote_refs, branch)
        candidate = ref_is_candidate(
            category, session_state, status, trust_tracking
        )
        if category == INTEGRATED and not candidate:
            # Due motivi diversi per non proporlo, e vanno detti diversi:
            # qualcuno ci sta lavorando, oppure non so cosa ci sia su origin.
            if session_state is not None and session_state != SESSION_ABSENT:
                reason = f"{reason} — hold: worktree {session_state}"
            else:
                reason = f"{reason} — hold: {note or status}"
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
                remote_status=status,
                remote_note=note,
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
        sha_code, sha = _git(["rev-parse", "--verify", f"{name}^{{commit}}"], cwd)
        error = None
        if is_ancestor is None or unique is None:
            error = "git non ha risposto su antenato e/o commit unici"
        facts.append(
            RefFacts(
                name, is_ancestor, unique, date or None, error,
                tracking_sha=sha if sha_code == 0 and sha else None,
            )
        )
    return facts


def parse_claim_log(text: str) -> list[tuple[str, str, str]]:
    """Legge `git log --format='%H\\t%ad\\t%s'`. Ritorna (sha, data, oggetto)."""
    rows = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) < 3 or not parts[0].strip():
            continue
        rows.append((parts[0].strip(), parts[1].strip(), "\t".join(parts[2:]).strip()))
    return rows


def parse_contains(text: str) -> tuple[str, ...]:
    """Legge `git branch -r --contains`, scartando i puntatori simbolici.

    `origin/HEAD -> origin/master` non è un branch che «contiene» qualcosa: è
    un alias, e contarlo farebbe risultare claimato ogni ticket già mergiato.
    """
    branches = []
    for raw in text.splitlines():
        name = raw.strip()
        if not name or "->" in name:
            continue
        branches.append(name)
    return tuple(sorted(branches))


def gather_claims(
    ticket: str, base: str, cwd: str | None
) -> tuple[list[ClaimFacts] | None, str]:
    """Cerca l'ID fra i commit di TUTTI i ref remoti. `None` = ricerca fallita."""
    code, out = _git(
        [
            "log", "--remotes", "--fixed-strings", "-i", f"--grep={ticket}",
            "--format=%H%x09%ad%x09%s", "--date=short",
        ],
        cwd,
    )
    if code != 0:
        return None, f"`git log --grep` è uscito {code}: {out[:200]}"
    facts = []
    for sha, date, subject in parse_claim_log(out):
        # `%S` darebbe un solo ref, e per un ticket già mergiato sarebbe il
        # primo che git incontra (spesso `origin/production`): inutile per
        # decidere se qualcuno ci sta lavorando ADESSO. `--contains` li dà tutti.
        contains_code, contains_out = _git(
            ["branch", "-r", "--contains", sha], cwd
        )
        base_code, _ = _git(["merge-base", "--is-ancestor", sha, base], cwd)
        facts.append(
            ClaimFacts(
                sha=sha[:10],
                date=date,
                subject=subject,
                branches=parse_contains(contains_out) if contains_code == 0 else (),
                in_base=(True if base_code == 0 else False if base_code == 1 else None),
            )
        )
    return facts, f"{len(facts)} commit nominano l'ID"


def parse_ls_remote(text: str) -> dict[str, str]:
    """Legge `git ls-remote --heads`: `<sha>\\t refs/heads/<branch>`.

    Solo `refs/heads/`: i tag e `HEAD` non sono branch e non vanno confrontati
    con i ref di tracking.
    """
    heads = {}
    for line in text.splitlines():
        sha, _, ref = line.partition("\t")
        sha, ref = sha.strip(), ref.strip()
        if not sha or not ref.startswith("refs/heads/"):
            continue
        heads[ref[len("refs/heads/"):]] = sha
    return heads


def probe_remote_refs(
    remote: str, cwd: str | None, timeout: float = 60.0
) -> tuple[dict[str, str] | None, str, str]:
    """Chiede a origin quali branch esistono DAVVERO, e a che sha.

    È l'unica sonda che esce di macchina, ed è di sola lettura: `ls-remote` non
    scrive niente, né in locale né sul remote. `None` = non ho potuto chiedere,
    e allora nessun ref è candidato.
    """
    try:
        done = subprocess.run(
            ["git", "ls-remote", "--heads", remote], cwd=cwd,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, REMOTE_UNVERIFIED, f"ls-remote non eseguibile: {exc}"
    if done.returncode != 0:
        detail = (done.stderr or done.stdout or "").strip().splitlines()
        return None, REMOTE_UNVERIFIED, (
            f"ls-remote uscito {done.returncode}: {detail[:1]}"
        )
    heads = parse_ls_remote(done.stdout)
    return heads, "ok", f"{len(heads)} branch su {remote}"


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
        f"origin:   probe {census.remote_probe} — {census.remote_probe_detail}",
    ]
    if census.trusting_tracking:
        out.append(
            "⚠️  --no-remote-check: i candidati escono dai ref di TRACKING, "
            "non da origin. Se non hai appena fatto `git fetch --prune` "
            "possono essere già stati cancellati."
        )
    out += [
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

    out += ["", f"DA GUARDARE  [{census.needs_a_look}]"]
    if census.needs_a_look:
        for r in census.unknown_refs:
            out.append(f"    ref {r.name}: {r.reason}")
        for r in census.suspect_refs:
            out.append(f"    ref {r.name}: {r.remote_note}")
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


CLAIM_HEADLINE = {
    CLAIM_FREE: "LIBERO — puoi claimarlo",
    CLAIM_MINE: "TUO — lavoro già in corso su questo branch",
    CLAIM_TAKEN: "GIÀ CLAIMATO DA ALTRI — fermati",
    CLAIM_DONE: "GIÀ FATTO — risulta integrato nella base",
    CLAIM_UNKNOWN: "NON ACCERTABILE — non dico libero per ignoranza",
}


def render_claim_text(report: ClaimReport) -> str:
    out = [
        f"CLAIM — {report.ticket}",
        f"branch corrente: {report.own_branch}",
        "",
        f"{CLAIM_HEADLINE[report.verdict]}",
        f"  {report.reason}",
    ]
    if report.claims:
        out += ["", f"Commit che nominano l'ID  [{len(report.claims)}]"]
        for claim in report.claims:
            dove = ", ".join(claim.branches) or "nessun branch remoto"
            stato = "già nella base" if claim.in_base else "NON integrato"
            out.append(f"    {claim.sha}  {claim.date}  {claim.subject}")
            out.append(f"        {dove} — {stato}")
    if report.verdict == CLAIM_FREE:
        out += [
            "",
            "Prossimo passo (protocollo 2026-08-12):",
            f'    git commit --allow-empty -m "WIP(<scope>): <cosa> ({report.ticket})"',
            f"    git push origin {report.own_branch}",
        ]
    return "\n".join(out)


def render_claim_json(report: ClaimReport) -> str:
    payload = {
        "ticket": report.ticket,
        "verdict": report.verdict,
        "reason": report.reason,
        "own_branch": report.own_branch,
        "blocked": report.blocked,
        "other_branches": list(report.other_branches),
        "claims": [vars(c) | {"branches": list(c.branches)} for c in report.claims],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def claim_exit_code(report: ClaimReport) -> int:
    """0 libero o mio · 1 non accertabile · 4 preso da altri · 5 già fatto."""
    if report.verdict in (CLAIM_FREE, CLAIM_MINE):
        return 0
    if report.verdict == CLAIM_TAKEN:
        return 4
    if report.verdict == CLAIM_DONE:
        return 5
    return 1


def render_json(census: Census) -> str:
    payload = {
        "base": census.base,
        "base_sha": census.base_sha,
        "base_date": census.base_date,
        "session_probe": census.session_probe,
        "session_probe_detail": census.session_probe_detail,
        "remote_probe": census.remote_probe,
        "remote_probe_detail": census.remote_probe_detail,
        "trusting_tracking": census.trusting_tracking,
        "integrated": [vars(r) for r in census.integrated],
        "unique": [vars(r) for r in census.with_unique],
        "protected": [vars(r) for r in census.protected],
        "unknown_refs": [vars(r) for r in census.unknown_refs],
        "suspect_refs": [vars(r) for r in census.suspect_refs],
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


def current_branch(cwd: str | None) -> str:
    code, name = _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
    return name if code == 0 and name and name != "HEAD" else "(detached)"


def tracking_is_current(remote: str, cwd: str | None) -> tuple[bool | None, str]:
    """La mia copia dei ref remoti è allineata a origin?

    Se un branch su origin è andato avanti dopo l'ultimo fetch, un claim può
    esistere senza che io lo veda: allora «non ho trovato niente» non vale come
    «libero». Riusa `ls-remote`, la stessa sonda del gate sui candidati.
    """
    heads, state, detail = probe_remote_refs(remote, cwd)
    if heads is None:
        return None, detail
    behind = []
    for branch, live_sha in heads.items():
        code, local = _git(
            ["rev-parse", "--verify", f"{remote}/{branch}^{{commit}}"], cwd
        )
        if code != 0 or not local:
            behind.append(f"{branch} (mai fetchato)")
        elif not (live_sha.startswith(local) or local.startswith(live_sha)):
            behind.append(branch)
    if behind:
        return False, f"indietro su: {', '.join(sorted(behind))}"
    return True, f"allineata a {remote} ({len(heads)} branch)"


def run_claim(args) -> int:
    ticket = args.claim.strip()
    own = args.branch or current_branch(args.repo)
    claims, detail = gather_claims(ticket, args.base, args.repo)
    fresh, fresh_detail = tracking_is_current(args.remote, args.repo)
    report = classify_claims(
        ticket, claims or [], own,
        search_ok=claims is not None,
        # `None` (non ho potuto chiedere a origin) vale come NON allineata:
        # è il verso prudente, l'unico che non produce un «libero» inventato.
        view_is_current=fresh is True,
    )
    if claims is None:
        report.reason = detail
    elif fresh is not True and report.verdict == CLAIM_UNKNOWN:
        report.reason = f"{report.reason} [{fresh_detail}]"
    print(
        render_claim_json(report) if args.as_json else render_claim_text(report)
    )
    return claim_exit_code(report)


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
    parser.add_argument("--no-remote-check", action="store_true",
                        help="non interroga origin: accetta i ref di tracking "
                             "come autorità (deroga esplicita al fail-closed)")
    parser.add_argument("--protected", default=",".join(DEFAULT_PROTECTED),
                        help="branch mai proposti per la cancellazione")
    parser.add_argument("--strict", action="store_true",
                        help="esce 3 se ci sono candidati da smaltire")
    parser.add_argument("--claim", metavar="ID-TICKET", default=None,
                        help="cerca chi ha già claimato questo ticket ed esci")
    parser.add_argument("--branch", default=None,
                        help="il proprio branch (default: quello corrente)")
    args = parser.parse_args(argv)

    if args.claim:
        return run_claim(args)

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

    if args.no_remote_check:
        remote_refs, remote_state, remote_detail = None, REMOTE_UNVERIFIED, (
            "--no-remote-check: origin non interrogato, valgono i ref di tracking"
        )
    else:
        remote_refs, remote_state, remote_detail = probe_remote_refs(
            args.remote, args.repo
        )

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
        remote_refs=remote_refs,
        remote_probe=remote_state,
        remote_probe_detail=remote_detail,
        trust_tracking=args.no_remote_check,
    )

    print(render_json(census) if args.as_json else render_text(census))
    return exit_code(census, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
