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
