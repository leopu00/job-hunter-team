"""The site's requirements say what the 0.4 is: a Mac with Apple silicon, Podman managed by the app.

The setup guide, its requirements card and the «how it runs» page used to say
that Docker is required on macOS and Linux, that the app installs Podman in WSL
on Windows, and carried a measurement taken on Windows with Docker Desktop in
0.3.9. None of that is true for 0.4: the app installs and manages Podman on the
Mac, Windows is not supported and Linux is experimental. A number that was not
measured on this version is not written.

What the Mac needs before the app is read from the installer the app runs
(`install.sh --runtime podman`), not written from memory: Homebrew must already
be there (the app stops with `homebrew_missing` otherwise), and the container
machine it creates has the CPUs, memory and disk that the installer sets.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LANGS = ["en", "it", "es", "fr", "de", "pt", "hu"]


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


INSTALL = text("scripts/install.sh")
ONBOARDING = text("desktop/src-tauri/src/onboarding.rs")
GUIDE = text("web/app/setup-guide/guide-content.ts")
CARD = text("web/app/setup-guide/requirements-card.i18n.ts")
RUN = text("web/app/run/page.tsx")


def guide_requirements(lang: str) -> str:
    start = GUIDE.index('id: "check-requirements"')
    body = GUIDE.index("body: {", start)
    line = re.compile(rf'\n          {lang}: "((?:[^"\\\n]|\\.)*)",\n').search(GUIDE, body)
    assert line, lang
    return line.group(1)


def card_block(name: str) -> str:
    match = re.search(rf"\b{name}[^\n]*\{{\n((?:  +[a-z]{{2}}: .*\n){{7}})", CARD)
    assert match, name
    return match.group(1)


def card_value(name: str, lang: str) -> str:
    match = re.search(rf'\n *{lang}: "((?:[^"\\\n]|\\.)*)",', "\n" + card_block(name))
    assert match, (name, lang)
    return match.group(1)


def systems(lang: str) -> str:
    block = CARD.split("export const REQUIREMENTS_CARD_SYSTEMS")[1]
    match = re.search(rf'\n  {lang}: "((?:[^"\\\n]|\\.)*)",', block)
    assert match, lang
    return match.group(1)


@pytest.mark.parametrize("lang", LANGS)
def test_the_guide_says_podman_is_managed_by_the_app_and_windows_and_linux_are_what_they_are(lang):
    body = guide_requirements(lang)
    assert "Podman" in body and "Homebrew" in body
    assert "Homebrew" in re.split(r"(?<=[.!?]) ", body)[0], "the first thing said is what must be there before the app"
    assert "Docker Desktop" in body, "it says there is none to install"
    assert "0.4" in body and "Windows" in body and "Linux" in body
    for stale in ["WSL", "0.3.9", "12 GB", "2013", "Docker is required", "Docker è obbligatorio"]:
        assert stale not in body, f"{lang}: {stale}"
    # the sentence that was already true stays (the disk minimum is not invented); the 8 GB had no measurement behind it
    assert "8 GB" not in body and "8 Go" not in body


@pytest.mark.parametrize("lang", LANGS)
def test_the_card_names_podman_the_supported_systems_and_no_windows_measurement(lang):
    assert "Podman" in card_value("docker", lang) and "Homebrew" in card_value("docker", lang)
    assert "WSL" not in card_value("docker", lang)
    said = systems(lang)
    for word in ["Windows", "Linux", "Apple silicon" if lang != "de" and lang != "pt" and lang != "hu" else "Apple"]:
        assert word in said, f"{lang}: {word}"
    assert "0.4" in said
    for stale in ["0.3.9", "Docker Desktop", "12 GB", "2013"]:
        assert stale not in said


def test_no_measurement_taken_on_windows_with_docker_desktop_is_left_in_the_requirements():
    for source in [GUIDE, CARD]:
        assert "0.3.9" not in source
        assert "REQUIREMENTS_CARD_EVIDENCE" not in source
    assert "REQUIREMENTS_CARD_SYSTEMS" in text("web/app/setup-guide/RequirementsCard.tsx")
    assert "Docker" not in "".join(re.findall(r'\n    en: "([^"\n]*)"', card_block("docker")))
    # the card's row is the container engine, not a product name that is no longer asked
    assert '"Container engine"' in text("web/app/setup-guide/RequirementsCard.tsx")


def test_the_run_page_asks_for_no_docker_and_says_who_prepares_the_runtime():
    assert "Docker" not in RUN
    assert RUN.count("Podman") >= 7 * 2, "the local mode and the desktop app's description, in seven languages"
    assert "Only requirement: Docker" not in RUN
    for lang_text in re.findall(r'req: "([^"\n]*)"', RUN):
        assert "Docker" not in lang_text
    assert RUN.lower().count("apple silicon") >= 7 * 2


def installer_constant(name: str) -> int:
    match = re.search(rf"^{name}=(\d+)$", INSTALL, re.MULTILINE)
    assert match, name
    return int(match.group(1))


def test_what_the_pages_say_about_the_container_machine_is_what_the_installer_creates():
    cpus = installer_constant("PODMAN_MACHINE_CPUS")
    memory_mib = installer_constant("PODMAN_MACHINE_MEMORY_MIB")
    disk_gib = installer_constant("PODMAN_MACHINE_DISK_GIB")
    assert memory_mib % 1024 == 0
    memory_gib = memory_mib // 1024
    for lang in LANGS:
        body = guide_requirements(lang)
        memory_row = card_value("memory", lang)
        assert re.search(rf"\b{cpus} CPU", body) and re.search(rf"\b{cpus} CPU", memory_row), lang
        assert re.search(rf"\b{memory_gib} GiB\b", body) and re.search(rf"\b{memory_gib} GiB\b", memory_row), lang
        assert re.search(rf"\b{disk_gib} GiB\b", body) and re.search(rf"\b{disk_gib} GiB\b", card_value("disk", lang)), lang
        # the recommendation for the whole Mac is a separate, round figure: it is said in both places
        assert re.search(r"\b16 G[Bo]\b", body) and re.search(r"\b16 G[Bo]\b", memory_row), lang


def test_the_homebrew_requirement_is_the_one_the_app_enforces_and_the_app_runs_podman_on_the_mac():
    # the app's local install on a Mac is `install.sh --runtime podman`, with Homebrew checked before anything runs
    assert re.search(r'LOCAL_PODMAN_INSTALL_ARGS: \[&str; 6\] = \[[^\]]*"--runtime",\s*"podman"', ONBOARDING)
    assert 'return Err("homebrew_missing")' in ONBOARDING
    assert "homebrew_missing: Homebrew is required" in INSTALL and "brew install podman" in INSTALL
    # the installer's free-space check is not run on a Mac (the disk is inside the machine): no free-space claim on the pages
    assert "case \"$OS\" in linux|wsl) ;; *) return 0 ;; esac" in INSTALL
    assert RUN.count("Homebrew") >= 7, "the local mode says Homebrew in every language"


# ---- the rest of the guide, the download page and the getting-started guide

GUIDE_STEPS = text("web/app/setup-guide/guide-content.ts")
SCREENS = text("web/app/setup-guide/guide-screens.ts")
CONFIG = text("web/app/setup-guide/guide-config.ts")
DOWNLOAD = text("web/app/download/DownloadClient.tsx")
STARTED_I18N = text("web/app/docs/guides/getting-started/page.i18n.ts")
STARTED_PAGE = text("web/app/docs/guides/getting-started/page.tsx")
LANDING = text("web/app/components/landing/LandingI18n.tsx")


def step(step_id: str) -> str:
    start = GUIDE_STEPS.index(f'id: "{step_id}"')
    end = GUIDE_STEPS.find('\n      {\n        id: "', start + 10)
    return GUIDE_STEPS[start:end if end != -1 else len(GUIDE_STEPS)]


def lang_line(block: str, lang: str, field: str) -> str:
    inside = block[block.index(f"{field}: {{"):]
    match = re.search(rf'\n          {lang}: "((?:[^"\\\n]|\\.)*)",', inside)
    assert match, (field, lang)
    return match.group(1)


def test_the_guide_has_a_mac_step_for_homebrew_a_windows_banner_and_a_linux_step_with_podman():
    assert 'os: ["macos"]' in step("install-homebrew-macos")
    assert "HOMEBREW_URL" in step("install-homebrew-macos")
    assert 'os: ["windows"]' in step("windows-not-supported")
    assert 'os: ["linux"]' in step("linux-needs-podman")
    for old in ["install-docker-windows", "install-docker-linux", "install-docker-macos"]:
        assert f'id: "{old}"' not in GUIDE_STEPS, old
    assert 'HOMEBREW_URL = "https://brew.sh"' in CONFIG
    for gone in ["DOCKER_URL", "WSL_URL"]:
        assert gone not in CONFIG and gone not in GUIDE_STEPS


@pytest.mark.parametrize("lang", LANGS)
def test_the_mac_windows_and_linux_steps_and_the_container_start_say_what_0_4_does(lang):
    mac = lang_line(step("install-homebrew-macos"), lang, "body")
    assert "Homebrew" in mac and "Podman" in mac and ".pkg" in mac
    windows_step = step("windows-not-supported")
    assert "0.4" in lang_line(windows_step, lang, "title") and "Windows" in lang_line(windows_step, lang, "title")
    assert "WSL" not in windows_step and "links:" not in windows_step, "no link to set up something that is not supported"
    linux = lang_line(step("linux-needs-podman"), lang, "body")
    assert "Podman" in linux and "5.0" in linux and "sud" in linux.lower()
    start = lang_line(step("start-container"), lang, "body")
    assert "Podman" in start and "Homebrew" in start
    for stale in ["WSL", "Docker Engine", "Colima"]:
        assert stale not in start and stale not in linux and stale not in mac


def test_the_linux_step_says_what_the_linux_installer_needs():
    # rootless Podman at the versions the installer enforces, with a sudo that asks for no password
    assert 'PODMAN_MIN_VERSION="5.0.0"' in INSTALL and 'PODMAN_COMPOSE_MIN_VERSION="1.1.0"' in INSTALL
    assert "sudo -n" in INSTALL


def test_no_page_asks_for_docker_or_gives_the_old_unmeasured_figures():
    for name, source in {"download page": DOWNLOAD, "screens": SCREENS, "landing": LANDING, "started page": STARTED_PAGE}.items():
        assert "Docker" not in source, name
    # the key names carry no product name either
    assert "docker" not in STARTED_I18N.lower()
    for stale in ["4 GB minimum", "8 GB recommended", "~35 GB", "Colima", "Docker Desktop"]:
        assert stale not in DOWNLOAD, stale
    tables = re.findall(r"reqRows: \[(.*?)\n    \],\n  \}", DOWNLOAD, re.S)
    assert len(tables) == 7
    for lang_rows in tables:
        assert "Homebrew" in lang_rows and re.search(r"\b16 G[Bo]\b", lang_rows)
        # the machine's memory and disk are written in the installer's own unit
        assert f"{installer_constant('PODMAN_MACHINE_MEMORY_MIB') // 1024} GiB" in lang_rows
        assert f"{installer_constant('PODMAN_MACHINE_DISK_GIB')} GiB" in lang_rows
    assert DOWNLOAD.count("Homebrew") >= 14, "the requirements table and the assistant prompt, in seven languages"
    # the figures of the table are the installer's
    cpus = installer_constant("PODMAN_MACHINE_CPUS")
    assert re.search(rf'\["CPU", "{cpus} ', DOWNLOAD)
    assert "S02-docker" not in SCREENS and not (ROOT / "web/public/setup-guide/S02-docker-missing-linux.png").exists()


def test_the_getting_started_guide_names_homebrew_and_the_0_4_systems_in_every_language():
    assert "<strong>Homebrew</strong>" in STARTED_PAGE
    blocks = re.findall(r"requirementB:\s*\n?\s*\"((?:[^\"\\\n]|\\.)*)\"", STARTED_I18N)
    assert len(blocks) == 7
    for body in blocks:
        assert "Windows" in body and "Linux" in body and "0.4" in body
        assert "WSL" not in body and "Docker" not in body


# ── What is not in 0.4.0 is written "not in this version", and the Mac pages match the app ──

FUTURE_PROMISES = re.compile(
    r"coming soon|\bin arrivo\b|Presto disponibile|Arriverà presto|próximamente|Llegará pronto|bientôt|"
    r"demnächst|Er kommt bald|em breve|Chega em breve|Hamarosan érkezik|hamarosan érkező|hamarosan az asztali|"
    r"\"Hamarosan\"|is on its way|ist unterwegs|está en camino|úton van|está a caminho|upcoming desktop|future version|prossima versione|"
    r"A Windows nem része a 0\.4\.0-nak: ebben a kiadásban még nincs",
    re.IGNORECASE,
)
PAGES_WITHOUT_PROMISES = [
    "web/app/download/DownloadClient.tsx",
    "web/lib/download-funnel.ts",
    "web/app/components/landing/LandingI18n.tsx",
    "web/app/components/landing/i18n/pt.ts",
    "web/app/components/landing/i18n/fr.ts",
    "web/app/components/landing/i18n/es.ts",
    "web/app/components/landing/i18n/de.ts",
    "web/app/docs/guides/getting-started/page.i18n.ts",
    "web/app/docs/guides/getting-started/page.tsx",
    "web/app/docs/guides/team-gmail/page.i18n.tsx",
    "web/app/docs/guides/email-forwarding/page.i18n.tsx",
    "web/app/docs/guides/faq/page.i18n.ts",
    "web/app/docs/guides/beta/page.i18n.ts",
    "web/app/docs/guides/cli/page.tsx",
    "web/app/docs/guides/dashboard-and-results/page.tsx",
    "web/app/(protected)/settings/page.i18n.ts",
    "web/app/(protected)/settings/page.tsx",
    "web/app/setup-guide/guide-content.ts",
    "README.md",
    "docs/guides/CHOOSE-WHERE-TO-RUN.md",
    "docs/guides/QUICKSTART.md",
    "docs/guides/TUTORIALS.md",
    "docs/guides/TUTORIALS-LOCALIZATIONS.md",
]


@pytest.mark.parametrize("path", PAGES_WITHOUT_PROMISES)
def test_no_page_promises_a_feature_that_is_not_in_this_version(path):
    # A feature that is not in 0.4.0 is "not in this version": no date, no promise.
    # (Windows and the sign-in with ChatGPT are in progress, and may say so.)
    found = [m.group(0) for m in FUTURE_PROMISES.finditer(text(path))]
    assert not found, f"{path}: {found}"


@pytest.mark.parametrize("lang", ["pt", "fr", "es", "de"])
def test_the_windows_card_says_not_in_this_version_in_the_split_dictionaries(lang):
    source = text(f"web/app/components/landing/i18n/{lang}.ts")
    assert re.search(r'dl_windows_not_in_version: "[^"]+"', source)
    assert "dl_windows_coming_soon" not in source


def test_the_windows_card_says_not_in_this_version_in_it_en_hu():
    block = re.search(r"dl_windows_not_in_version: \{\n((?:    [a-z]{2}: .*\n){3})", LANDING)
    assert block, "it, en and hu"
    assert 'en: "Not in this version"' in block.group(1) and "dl_windows_coming_soon" not in LANDING
    assert 't("dl_windows_not_in_version")' in DOWNLOAD and "data-windows-not-in-version" in DOWNLOAD


@pytest.mark.parametrize("lang", LANGS)
def test_the_getting_started_desktop_path_is_the_mac_app_with_a_link_to_the_download(lang):
    start = re.search(rf"\n  {lang}: \{{", STARTED_I18N)
    block = STARTED_I18N[start.end():STARTED_I18N.find("\n  },\n", start.end())]
    title = re.search(r'path2Title: "([^"]*)"', block).group(1)
    assert "Apple silicon" in title and "macOS" in title
    body = re.search(r'path2A:\s*"([^"]*)"', block).group(1) + re.search(r'path2B: "([^"]*)"', block).group(1)
    assert "Homebrew" in body and "Podman" in body and "Windows" in body and "Linux" in body
    assert "path2Soon" not in block and "path3WinIntro" not in block
    assert 'href="/download"' in STARTED_PAGE


def test_the_getting_started_one_liner_has_no_windows_block_and_names_podman():
    assert "install.ps1" not in STARTED_PAGE and "iwr " not in STARTED_PAGE
    assert "path3WinIntro" not in STARTED_PAGE and "path3WinIntro" not in STARTED_I18N
    assert "install.sh | bash -s -- --runtime podman" in STARTED_PAGE
    for mac in re.findall(r'path3Mac: "([^"]*)"', STARTED_I18N):
        assert "WSL" not in mac and "Linux" in mac


@pytest.mark.parametrize("path", [
    "web/app/setup-guide/guide-config.ts", "web/app/download/DownloadClient.tsx", "README.md",
    "docs/guides/CLI-INSTALL.md", "docs/guides/QUICKSTART.md", "web/app/docs/guides/getting-started/page.tsx",
])
def test_the_mac_install_command_names_podman_so_it_does_not_land_on_colima(path):
    # `curl | bash` with no flag picks Colima on a Mac; the app, and the figures of the pages, are Podman's
    source = text(path)
    commands = re.findall(r"install\.sh \| bash[^\n`\"]*", source)
    assert commands, path
    assert all("-s -- --runtime podman" in c for c in commands), (path, commands)
    assert '--runtime) \n' not in INSTALL and "--runtime" in INSTALL and "colima|podman|docker-desktop" in INSTALL


@pytest.mark.parametrize("lang", LANGS)
def test_the_homebrew_step_says_it_needs_macos_15(lang):
    body = lang_line(step("install-homebrew-macos"), lang, "body")
    assert "macOS 15" in body or "macOS 15-" in body


@pytest.mark.parametrize("path", [
    "web/app/privacy/page.tsx", "web/app/docs/guides/run-on-a-vps/page.tsx", "web/app/docs/guides/cli/page.tsx", "README.md",
])
def test_no_page_of_the_site_or_the_readme_says_the_team_runs_in_docker(path):
    for line in text(path).splitlines():
        # the README says only that there is no Docker Desktop to install
        assert "Docker" not in line or "no Docker Desktop to install" in line, (path, line)


def test_the_choose_where_guide_names_docker_only_for_an_old_installation_or_to_say_it_is_not_needed():
    for line in text("docs/guides/CHOOSE-WHERE-TO-RUN.md").splitlines():
        if "Docker" in line:
            assert "Docker Desktop is not needed" in line or "earlier installation" in line, line
    assert "WSL" not in text("docs/guides/CHOOSE-WHERE-TO-RUN.md")


# ── The install guides in docs/guides say what 0.4 is: Podman, no Windows, the installer's figures ──

INSTALL_DOCS = ["docs/guides/QUICKSTART.md", "docs/guides/TUTORIALS.md", "docs/guides/CLI-INSTALL.md"]


@pytest.mark.parametrize("path", INSTALL_DOCS + ["docs/guides/TUTORIALS-LOCALIZATIONS.md"])
def test_no_install_guide_says_windows_runs_the_team_in_podman_inside_wsl_in_0_4(path):
    body = text(path)
    assert not re.search(r"Windows 0\.4|Windows 0\.4", body), path
    assert not re.search(r"Podman\s+(inside|dentro|dans|in|dentro de|dentro do)\s+(de\s+|do\s+)?WSL", body, re.IGNORECASE), path
    assert "WSL-en belül" not in body and "WSL-en belül futó Podman" not in body


@pytest.mark.parametrize("path", INSTALL_DOCS)
def test_the_install_guides_carry_the_figures_of_the_installer(path):
    body = " ".join(text(path).split())
    memory = f"{installer_constant('PODMAN_MACHINE_MEMORY_MIB') // 1024} GiB"
    disk = f"{installer_constant('PODMAN_MACHINE_DISK_GIB')} GiB"
    assert memory in body and disk in body and "16 GB" in body, path
    assert f"{installer_constant('PODMAN_MACHINE_CPUS')} CPUs" in body, path
    assert "macOS 15" in body and "Homebrew" in body, path
    assert "8 GB" not in body, path


def test_the_translated_tutorial_carries_the_same_figures_in_six_languages():
    body = " ".join(text("docs/guides/TUTORIALS-LOCALIZATIONS.md").split())
    assert body.count("4 GiB") >= 6 and body.count("30 GiB") >= 6
    assert len(re.findall(r"16 G[BoB]", body)) >= 6 and body.count("macOS 15") >= 6


@pytest.mark.parametrize("path", INSTALL_DOCS + ["docs/guides/TUTORIALS-LOCALIZATIONS.md"])
def test_the_install_guides_do_not_send_the_app_to_docker(path):
    body = text(path)
    assert not re.search(r"(app|aplicaci[oó]n|application|App|aplica[cç][aã]o|alkalmaz[aá]s)\s+(uses|usa|utilise|verwendet|Dockert)\s+(el\s+|o\s+)?Docker", body), path
    assert "Docker Engine and its Compose plugin" not in body and "Installs the **Docker runtime**" not in body
    assert "Docker Desktop is not needed" not in body


def test_the_quickstart_commands_name_podman_and_the_guides_do_not_call_it_a_preview():
    quick = text("docs/guides/QUICKSTART.md")
    for line in re.findall(r"^bash install\.sh[^\n]*$", quick, re.M):
        assert "--runtime podman" in line, line
    for path in INSTALL_DOCS:
        assert not re.search(r"podman[^\n]{0,80}preview|preview[^\n]{0,80}podman|Podman preparation preview", text(path), re.IGNORECASE), path


def test_no_page_of_the_site_names_docker_as_what_the_team_needs_or_runs_in():
    # run, download, privacy, the landing and the docs guides say nothing of Docker; the setup guide names it only
    # next to Podman ("no Docker Desktop to install", "Podman, not Docker")
    folders = ["web/app/run", "web/app/download", "web/app/privacy", "web/app/components/landing", "web/app/docs"]
    for folder in folders:
        for path in sorted((ROOT / folder).rglob("*")):
            if path.suffix in {".ts", ".tsx"} and ".test." not in path.name:
                assert "Docker" not in path.read_text(encoding="utf-8"), path.relative_to(ROOT)
    for line in GUIDE_STEPS.splitlines():
        assert "Docker" not in line or "Podman" in line, line.strip()[:120]
    for lang in ["pt", "fr", "es", "de"]:
        assert "Docker" not in text(f"web/app/components/landing/i18n/{lang}.ts"), lang
