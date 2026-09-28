"""Il ramo d'integrazione HQ deve ricevere i gate prima di arrivare in master."""

import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
HQ_GATES = ("ci.yml", "lint.yml", "test.yml", "security.yml")


def _workflow(name: str):
    # BaseLoader conserva la chiave YAML `on` come stringa anche sotto YAML
    # 1.1, dove SafeLoader la convertirebbe nel booleano True.
    return yaml.load(
        (WORKFLOWS / name).read_text(encoding="utf-8"),
        Loader=yaml.BaseLoader,
    )


def test_hq_master_receives_the_same_push_gates_as_master():
    for name in HQ_GATES:
        branches = _workflow(name)["on"]["push"]["branches"]
        assert set(branches) == {"master", "hq-master"}, name


def test_deploy_remains_production_only():
    branches = _workflow("deploy.yml")["on"]["push"]["branches"]
    assert branches == ["production"]


def test_game_push_is_already_branch_agnostic():
    push = _workflow("game.yml")["on"]["push"]
    assert "branches" not in push


def test_docker_does_not_publish_hq_integration_images():
    branches = _workflow("docker.yml")["on"]["push"]["branches"]
    assert branches == ["master"]


def test_docker_pull_requests_build_every_image_input_path():
    workflow = _workflow("docker.yml")["on"]
    assert set(workflow["pull_request"]["paths"]) == set(workflow["push"]["paths"])


def test_production_smoke_is_not_part_of_a_branch_gate():
    # A workflow_dispatch of test.yml is the gate of a branch before its merge.
    # The smoke asks the live site, not the branch: run on every dispatch it
    # put four ERROR 22P02 in the production Postgres log per run (27/09).
    workflow = _workflow("test.yml")
    smoke_input = workflow["on"]["workflow_dispatch"]["inputs"]["smoke"]
    assert smoke_input["default"] == "false"
    condition = " ".join(workflow["jobs"]["smoke"]["if"].split())
    assert "github.event_name == 'schedule'" in condition
    assert "(github.event_name == 'workflow_dispatch' && inputs.smoke)" in condition
    assert "github.event_name == 'workflow_dispatch')" not in condition


def test_local_supabase_e2e_runs_only_on_a_dispatch_that_asks_for_it():
    # Draft awaiting the operator's decision: the job must never become a
    # push, PR or cron gate by accident, and a plain branch-gate dispatch
    # must not start it either.
    workflow = _workflow("test.yml")
    local_input = workflow["on"]["workflow_dispatch"]["inputs"]["local_supabase_e2e"]
    assert local_input["type"] == "boolean"
    assert local_input["default"] == "false"
    condition = " ".join(workflow["jobs"]["e2e-local-supabase"]["if"].split())
    assert "github.event_name == 'workflow_dispatch' && inputs.local_supabase_e2e" in condition
    for other_event in ("push", "pull_request", "schedule"):
        assert f"'{other_event}'" not in condition
    assert "||" not in condition


def test_local_supabase_e2e_never_reads_the_production_test_account():
    job = _workflow("test.yml")["jobs"]["e2e-local-supabase"]
    text = str(job)
    assert "secrets." not in text
    assert "jobhunterteam.ai" not in text
    assert job["env"]["E2E_EMAIL"].endswith("@example.com")


def test_existing_e2e_gate_is_unchanged_by_the_draft():
    condition = " ".join(_workflow("test.yml")["jobs"]["e2e"]["if"].split())
    assert condition == (
        "github.repository == 'leopu00/job-hunter-team' && "
        "github.event_name != 'schedule'"
    )


def test_production_auth_canary_lives_only_in_smoke():
    jobs = _workflow("test.yml")["jobs"]
    owners = [
        name
        for name, job in jobs.items()
        for step in job.get("steps", [])
        if "canary/playwright.config.ts" in step.get("run", "")
    ]
    assert owners == ["smoke"]
    canary = next(
        step
        for step in jobs["smoke"]["steps"]
        if "canary/playwright.config.ts" in step.get("run", "")
    )
    assert canary["env"]["E2E_PROD_CANARY"] == "1"
    # The canary spec sits outside e2e/tests/, the only testDir of the main
    # Playwright config, so the `e2e` jobs can never collect it.
    main_config = (ROOT / "e2e" / "playwright.config.ts").read_text(encoding="utf-8")
    assert 'testDir: "./tests"' in main_config
    assert (ROOT / "e2e" / "canary" / "prod-auth-canary.spec.ts").is_file()
    assert not list((ROOT / "e2e" / "tests").rglob("*canary*"))


def test_production_auth_canary_runs_only_on_a_dispatch_that_asks_for_it():
    # A draft until the operator decides: never on smoke's cron.
    workflow = _workflow("test.yml")
    inputs = workflow.get(True, workflow.get("on"))["workflow_dispatch"]["inputs"]
    assert inputs["prod_canary"]["type"] == "boolean"
    assert str(inputs["prod_canary"]["default"]).lower() == "false"
    steps = [
        step
        for step in workflow["jobs"]["smoke"]["steps"]
        if "canary" in (step.get("name", "") + str(step.get("env", "")) + str(step.get("run", ""))).lower()
    ]
    assert steps
    for step in steps:
        assert "github.event_name == 'workflow_dispatch' && inputs.prod_canary" in str(step.get("if", ""))


def test_the_local_supabase_project_is_invisible_to_the_cli_run_from_the_repository():
    # A config.toml at the root of supabase/ is read by every CLI command run
    # from the repository, the linked production project included
    # (`migration list --linked`, `config push`): the local project lives in
    # its own folder and the job builds its workdir in the runner's temp.
    assert not (ROOT / "supabase" / "config.toml").exists()
    assert (ROOT / "supabase" / "e2e-local" / "config.toml").is_file()
    job = _workflow("test.yml")["jobs"]["e2e-local-supabase"]
    commands = [
        line.strip()
        for step in job["steps"]
        for line in str(step.get("run", "")).splitlines()
        if re.search(r"(^|[\s$(\"])supabase\s", line)
    ]
    assert commands
    for command in commands:
        assert '--workdir "$SUPABASE_E2E_WORKDIR"' in command, command
