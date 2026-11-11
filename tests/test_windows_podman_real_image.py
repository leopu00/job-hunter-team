"""The Windows real-Podman job runs the broker and the Telegram service in an image that has them (T146).

Origin: the job `windows-podman-real.yml` was red in every run since the portal-secrets broker and the Telegram
service came (24/10 to 03/11, 12 runs and more): after 300 s of install, «runtime_containers_unhealthy: jht-broker is
stopped (exit 127); jht-telegram is stopped (exit 127)». 127 is «command not found». The job installed the release pin
(release/runtime-image.v1.json: `ghcr.io/leopu00/jht@sha256:07b154be...`, built from 5357f762 on 14/08) with the compose
of the commit under test, and that image has neither `/usr/local/bin/jht-broker` nor `/usr/local/bin/jht-telegram-service`
(read from its layers: the only jht-* links in /usr/local/bin are the tools of the agents, `app/shared/broker` is not in
it). The compose of the commit starts both by name, so both left at once.

The job now takes the image the TEST builds of the pile are pushed under (the tag `master-arthur`, as a digest) and
gives it to install.ps1 through JHT_IMAGE. These tests keep the pieces together: the job's step, its place, and that
the Dockerfile makes the command every compose service starts.
"""

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "windows-podman-real.yml"
COMPOSE = ROOT / "docker-compose.yml"
DOCKERFILE = ROOT / "Dockerfile"
STEP = "Take the runtime image of the pile (the tag master-arthur, as a digest)"


def _steps():
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    return workflow["jobs"]["real-podman"]["steps"]


def _names(steps):
    return [step.get("name", "") for step in steps]


def test_the_job_takes_the_image_of_the_pile_before_the_first_install():
    steps = _steps()
    names = _names(steps)
    assert STEP in names
    first_install = next(index for index, name in enumerate(names) if name.startswith("Install (first"))
    assert names.index(STEP) < first_install
    step = steps[names.index(STEP)]
    script = step["run"]
    # the tag, read as a digest the way a registry gives it, and handed to every later step as JHT_IMAGE
    assert "manifests/master-arthur" in script
    assert "Docker-Content-Digest" in script
    assert re.search(r"\^sha256:\[0-9a-f\]\{64\}\$", script), "the digest is checked before it is used"
    assert 'JHT_IMAGE=ghcr.io/leopu00/jht@$digest' in script and "$env:GITHUB_ENV" in script


def test_the_job_does_not_name_the_release_pin_nor_a_tag_install_ps1_cannot_take():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "07b154bee43f32d2e6313c54f28e389836556e2b5cbe1b76d03398684c38b598" not in text
    # install.ps1 under 5.1 drops an empty native argument: a tag has no digest to pass as -ExpectedImageDigest
    assert not re.search(r"JHT_IMAGE=ghcr\.io/leopu00/jht:", text)


def test_the_job_runs_under_windows_powershell_51_where_the_step_is_written():
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert workflow["jobs"]["real-podman"]["defaults"]["run"]["shell"] == "powershell"
    script = next(step for step in _steps() if step.get("name") == STEP)["run"]
    # 5.1 has neither `?.` nor `-Parallel`; the step uses -UseBasicParsing on both calls (no IE engine on the runner)
    assert "?." not in script and script.count("-UseBasicParsing") == 2


def test_every_command_a_compose_service_starts_by_name_is_made_by_the_dockerfile():
    compose = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")
    made = set(re.findall(r"ln -sf \S+ /usr/local/bin/([\w.-]+)", dockerfile))
    wanted = {}
    for name, service in compose["services"].items():
        entrypoint = [str(word) for word in service.get("entrypoint") or []]
        command = [str(word) for word in service.get("command") or []]
        for word in entrypoint + command:
            if word.startswith("/usr/local/bin/"):
                wanted[word.rsplit("/", 1)[1]] = name
        # a bare command after tini: `entrypoint: [tini, -g, --]` and `command: [jht-telegram-service]`
        if entrypoint[-1:] == ["--"] and command:
            wanted[command[0]] = name
    assert {"jht-broker", "jht-telegram-service"} <= set(wanted), wanted
    missing = {binary: service for binary, service in wanted.items() if binary not in made and binary != "pid1"}
    assert not missing, f"the compose starts them and no image built from this Dockerfile has them: {missing}"


def test_the_job_serves_every_script_install_ps1_downloads():
    """Every run since 10/11 failed in 2 s, «Download failed: .../scripts/jht-integration.ps1 (404)» (and jht-tools.ps1 came
    next): the step served a list of names and install.ps1's list had grown. The step serves the folder, and every
    runtime file install.ps1 names must exist in it."""
    install = (ROOT / "web" / "public" / "install.ps1").read_text(encoding="utf-8")
    # the list the install parses after the download (bare names) and the one it downloads from (scripts/<name>)
    checked = re.search(r"function Test-JhtDownloadedRuntimeScripts.*?foreach \(\$ps1 in @\((.*?)\)\)", install, re.S).group(1)
    names = set(re.findall(r"'(scripts/[A-Za-z0-9._-]+)'", install)) | set(
        "scripts/" + name for name in re.findall(r"'([A-Za-z0-9._-]+\.ps1)'", checked)
    )
    assert {"scripts/jht-integration.ps1", "scripts/jht-tools.ps1", "scripts/jht-wrapper.ps1"} <= names
    served = _steps()
    step = next(step for step in served if step.get("name", "").startswith("Serve this commit's runtime files"))
    script = step["run"]
    assert "Copy-Item -Path 'scripts\\*'" in script and "-Recurse" in script
    assert "docker-compose.yml" in script and "docker-compose.podman.yml" in script
    # the names found above are files of the folder the step copies (a name with a typo would be a 404 again)
    missing = sorted(name for name in names if (name.endswith(".ps1") or name.endswith(".py")) and not (ROOT / name).is_file())
    assert not missing, missing
