"""Il ramo d'integrazione HQ deve ricevere i gate prima di arrivare in master."""

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
