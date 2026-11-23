"""Dati privati nel pre-commit e nel pre-push: le stesse regole, un solo script.

Ogni test crea un repo usa e getta con un remoto bare e fa push VERI con
core.hooksPath puntato a .githooks di questo albero: e' git a passare le righe
dei ref sullo stdin del pre-push, come per chi lavora davvero. I commit nascono
con --no-verify, cioe' proprio il caso che il pre-push deve fermare.

I dati privati sono FINTI e composti a runtime: scritti per intero qui, li
fermerebbe il pre-commit di chi committa questo file.
"""

from pathlib import Path
import os
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
HOOKS = ROOT / ".githooks"
SCRIPT = HOOKS / "private-data.sh"

FAKE_IP = ".".join(["8", "26", "113", "7"])
FAKE_MAIL = "mario.rossi.finto" + "@" + "posta-finta.it"
FAKE_TOKEN = "ghp" + "_" + "Ab3" * 12
# Un token Slack finto: nessuna regola dello script lo conosce, gitleaks si'.
FAKE_SLACK = "xox" + "b-" + "1234567890" + "-" + "1234567890123" + "-" + "aB3dE6gH9jK2mN5pQ8sT1vW4"


def bash_executable() -> str:
    if os.name == "nt":
        git_bash = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe"
        if git_bash.is_file():
            return str(git_bash)
    return shutil.which("bash") or "bash"


class Repo:
    def __init__(self, tmp_path: Path, gitleaks_exit: int | None = 0) -> None:
        self.dir = tmp_path / "work"
        self.remote = tmp_path / "remote.git"
        self.dir.mkdir()
        gitconfig = tmp_path / "gitconfig"
        gitconfig.write_text(
            "[user]\n\tname = Hook Test\n\temail = hook-test@example.com\n"
            "[init]\n\tdefaultBranch = main\n",
            encoding="utf-8",
        )
        self.env = dict(os.environ)
        self.env.update(
            {
                "GIT_CONFIG_GLOBAL": str(gitconfig),
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_TERMINAL_PROMPT": "0",
            }
        )
        # gitleaks finto, sempre primo nel PATH: il test decide cosa risponde
        # e il gitleaks vero della macchina non cambia l'esito. None = assente.
        self.calls = tmp_path / "gitleaks-calls.txt"
        if gitleaks_exit is not None:
            bindir = tmp_path / "bin"
            bindir.mkdir()
            fake = bindir / "gitleaks"
            fake.write_text(
                "#!/usr/bin/env bash\n"
                f'printf "%s\\n" "$*" >> "{self.calls.as_posix()}"\n'
                f"exit {gitleaks_exit}\n",
                encoding="utf-8",
            )
            fake.chmod(0o755)
            self.env["PATH"] = str(bindir) + os.pathsep + self.env["PATH"]
        elif shutil.which("gitleaks"):
            self.env["PATH"] = os.pathsep.join(
                p for p in self.env["PATH"].split(os.pathsep)
                if not (Path(p) / "gitleaks").exists() and not (Path(p) / "gitleaks.exe").exists()
            )
        subprocess.run(["git", "init", "-q", "--bare", str(self.remote)], check=True, env=self.env)
        self.git("init", "-q")
        self.git("remote", "add", "origin", str(self.remote))

    def git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args], cwd=self.dir, env=self.env, text=True, capture_output=True, check=check
        )

    def commit(self, path: str, text: str, message: str) -> str:
        target = self.dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        self.git("add", path)
        self.git("commit", "-q", "--no-verify", "-m", message)
        return self.git("rev-parse", "HEAD").stdout.strip()

    def push(self, *args: str) -> subprocess.CompletedProcess[str]:
        return self.git("-c", f"core.hooksPath={HOOKS.as_posix()}", "push", "origin", *args, check=False)

    def remote_has(self, ref: str) -> bool:
        return self.git("ls-remote", "origin", ref).stdout.strip() != ""


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    r = Repo(tmp_path)
    r.commit("README.md", "progetto\n", "primo")
    first = r.push("main")
    assert first.returncode == 0, first.stdout + first.stderr
    return r


def output(result: subprocess.CompletedProcess[str]) -> str:
    return result.stdout + result.stderr


def test_clean_range_passes(repo: Repo) -> None:
    repo.commit("docs/guida.md", "server di esempio 192.0.2.10, posta a info@example.com\n", "guida")
    repo.commit("src/app.py", "HOST = '127.0.0.1'\n", "app")
    result = repo.push("main")
    assert result.returncode == 0, output(result)
    assert "BLOCCATO" not in output(result)


@pytest.mark.parametrize(
    ("text", "rule", "shown"),
    [
        (f"ssh root@{FAKE_IP}\n", "IP pubblico", FAKE_IP),
        (f"contatto: {FAKE_MAIL}\n", "email", FAKE_MAIL),
        (f"TOKEN = '{FAKE_TOKEN}'\n", "possibile segreto", FAKE_TOKEN[:15] + "..."),
    ],
)
def test_private_data_in_range_blocks_and_names_commit_file_rule(
    repo: Repo, text: str, rule: str, shown: str
) -> None:
    repo.commit("docs/pulito.md", "niente\n", "pulito")
    bad = repo.commit("ops/note.md", text, "note")
    repo.commit("docs/dopo.md", "ancora niente\n", "dopo")
    result = repo.push("main")
    out = output(result)
    assert result.returncode == 1, out
    assert f"{bad[:9]}  ops/note.md  {rule}: {shown}" in out
    assert "docs/pulito.md" not in out and "docs/dopo.md" not in out
    assert not repo.git("ls-remote", "origin", "main").stdout.startswith(bad)
    if rule == "possibile segreto":
        assert FAKE_TOKEN not in out


def test_first_push_of_a_new_branch_checks_only_its_new_commits(repo: Repo) -> None:
    repo.git("switch", "-q", "-c", "nuovo")
    repo.commit("a.md", "pulito\n", "pulito")
    clean = repo.push("nuovo")
    assert clean.returncode == 0, output(clean)

    repo.git("switch", "-q", "-c", "altro")
    bad = repo.commit("b.md", f"{FAKE_MAIL}\n", "mail")
    result = repo.push("altro")
    assert result.returncode == 1, output(result)
    assert f"{bad[:9]}  b.md  email" in output(result)
    assert not repo.remote_has("refs/heads/altro")


def test_deleting_a_branch_passes(repo: Repo) -> None:
    repo.git("switch", "-q", "-c", "da-cancellare")
    repo.commit("a.md", "pulito\n", "pulito")
    assert repo.push("da-cancellare").returncode == 0
    # Un commit sporco solo in locale non c'entra con una cancellazione.
    repo.commit("b.md", f"{FAKE_IP}\n", "sporco locale")
    repo.git("switch", "-q", "main")
    result = repo.push("--delete", "da-cancellare")
    assert result.returncode == 0, output(result)
    assert not repo.remote_has("refs/heads/da-cancellare")


def test_merge_brings_a_dirty_commit_from_an_unpushed_branch(repo: Repo) -> None:
    repo.git("switch", "-q", "-c", "lato")
    bad = repo.commit("lato.md", f"{FAKE_IP}\n", "lato sporco")
    repo.git("switch", "-q", "main")
    repo.commit("main.md", "pulito\n", "main")
    repo.git("merge", "-q", "--no-ff", "--no-verify", "-m", "unisci lato", "lato")
    result = repo.push("main")
    out = output(result)
    assert result.returncode == 1, out
    assert f"{bad[:9]}  lato.md  IP pubblico" in out


def test_merge_of_an_already_public_branch_is_clean(repo: Repo) -> None:
    # Un esempio vecchio, gia' pubblico (entrato prima del controllo): il merge
    # che lo porta su main non deve rifermarlo.
    repo.git("switch", "-q", "-c", "vecchio")
    repo.commit("storia.md", f"{FAKE_IP}\n", "storia")
    repo.git("-c", "core.hooksPath=/nessun-hook", "push", "-q", "origin", "vecchio")
    repo.git("switch", "-q", "main")
    repo.commit("main.md", "pulito\n", "main")
    repo.git("merge", "-q", "--no-ff", "--no-verify", "-m", "unisci vecchio", "vecchio")
    result = repo.push("main")
    assert result.returncode == 0, output(result)


def test_evil_merge_adds_data_only_in_the_merge_commit(repo: Repo) -> None:
    repo.commit("conf.txt", "riga\n", "base")
    assert repo.push("main").returncode == 0
    repo.git("switch", "-q", "-c", "lato")
    repo.commit("conf.txt", "riga lato\n", "lato")
    repo.git("switch", "-q", "main")
    repo.commit("conf.txt", "riga main\n", "main")
    merge = repo.git("merge", "-q", "--no-verify", "lato", check=False)
    assert merge.returncode != 0  # conflitto voluto
    (repo.dir / "conf.txt").write_text(f"riga risolta {FAKE_IP}\n", encoding="utf-8")
    repo.git("add", "conf.txt")
    repo.git("commit", "-q", "--no-verify", "-m", "unisci con risoluzione")
    merge_sha = repo.git("rev-parse", "HEAD").stdout.strip()
    result = repo.push("main")
    out = output(result)
    assert result.returncode == 1, out
    assert f"{merge_sha[:9]}  conf.txt  IP pubblico: {FAKE_IP}" in out


def test_identity_file_is_still_blocked(repo: Repo) -> None:
    repo.commit("agents/x/CLAUDE.md", "identita'\n", "identita")
    result = repo.push("main")
    assert result.returncode == 1
    assert "file d'identita' agente" in output(result)


def test_gitleaks_finding_blocks_the_push(tmp_path: Path) -> None:
    r = Repo(tmp_path, gitleaks_exit=3)
    r.commit("a.md", "pulito\n", "pulito")
    result = r.push("main")
    assert result.returncode == 1, output(result)
    assert "gitleaks ha trovato segreti" in output(result)
    call = r.calls.read_text(encoding="utf-8")
    assert "--log-opts=" in call and "--not --remotes" in call and "--redact" in call


def test_gitleaks_that_fails_only_warns(tmp_path: Path) -> None:
    r = Repo(tmp_path, gitleaks_exit=1)
    r.commit("a.md", "pulito\n", "pulito")
    result = r.push("main")
    assert result.returncode == 0, output(result)
    assert "gitleaks non e' riuscito" in output(result)


def test_without_gitleaks_the_push_still_runs_the_rules(tmp_path: Path) -> None:
    r = Repo(tmp_path, gitleaks_exit=None)
    r.commit("a.md", "pulito\n", "pulito")
    assert r.push("main").returncode == 0
    bad = r.commit("b.md", f"{FAKE_IP}\n", "sporco")
    result = r.push("main")
    assert result.returncode == 1
    assert f"{bad[:9]}  b.md  IP pubblico" in output(result)


@pytest.mark.skipif(shutil.which("gitleaks") is None, reason="gitleaks non installato")
def test_real_gitleaks_accepts_the_flags_and_finds_what_the_rules_miss(tmp_path: Path) -> None:
    r = Repo(tmp_path, gitleaks_exit=None)
    r.env["PATH"] = os.environ["PATH"]
    r.commit("a.md", "pulito\n", "pulito")
    clean = r.push("main")
    assert clean.returncode == 0, output(clean)
    assert "gitleaks non e' riuscito" not in output(clean)
    r.commit("slack.py", f"SLACK = '{FAKE_SLACK}'\n", "slack")
    result = r.push("main")
    out = output(result)
    assert result.returncode == 1, out
    assert "gitleaks ha trovato segreti" in out and "slack.py" in out
    assert FAKE_SLACK not in out


def test_pre_commit_uses_the_same_script_and_names_the_file(tmp_path: Path) -> None:
    r = Repo(tmp_path)
    (r.dir / "ops").mkdir()
    (r.dir / "ops" / "note.md").write_text(f"{FAKE_MAIL}\n", encoding="utf-8")
    r.git("add", "ops/note.md")
    result = subprocess.run(
        [bash_executable(), (HOOKS / "pre-commit").as_posix()],
        cwd=r.dir, env=r.env, text=True, capture_output=True, check=False,
    )
    assert result.returncode == 1, output(result)
    assert f"indice  ops/note.md  email: {FAKE_MAIL}" in output(result)


def test_both_hooks_call_the_shared_script() -> None:
    for hook in ("pre-commit", "pre-push"):
        text = (HOOKS / hook).read_text(encoding="utf-8")
        assert "private-data.sh" in text
        # Le regole vivono solo nello script: nessuna copia che possa divergere.
        assert "grep -oE '\\b([0-9]{1,3}" not in text
        assert "SECRET_PATTERNS=" not in text
