"""scripts/ci/image_tiers.py: the checks that compare the core and the full image.

No engine here: the functions that talk to docker are replaced, so each check is proved to
FAIL when the thing it guards is wrong (a check that cannot fail proves nothing)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("image_tiers", ROOT / "scripts" / "ci" / "image_tiers.py")
tiers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tiers)

REVISION = "a" * 40
SAME = {"app-names": "1", "app-bytes": "2", "pi-names": "3", "pi-bytes": "4", "users": "5", "groups": "6", "links": "7"}
SWEEP_OK = json.dumps({"tools": {"playwright_browser": {"status": "NOT_INSTALLED"}, "cv_pdf_render": {"status": "NOT_INSTALLED"}}})


SWEEP_EXTRAS_OK = json.dumps({"tools": {"playwright_browser": {"status": "NOT_INSTALLED"}, "linkedin_check": {"status": "NOT_INSTALLED"},
                                        "cv_pdf_render": {"status": "NOT_INSTALLED"}, "manual_login_browser": {"status": "OK"}}})


def info(tier, size, revision=REVISION):
    return {"Size": size, "Config": {"Env": ["PATH=/bin", f"JHT_IMAGE_TIER={tier}"], "Labels": {tiers.REVISION_LABEL: revision}}}


class World:
    """Two fake images; every field can be broken one at a time."""

    def __init__(self):
        self.infos = {"core": info("core", 600), "full": info("full", 2000), "extras": info("extras", 1200)}
        self.tools = {"core": set(), "full": set(tiers.TOOLS), "extras": set(tiers.EXTRAS_TOOLS)}
        self.digests = {"core": dict(SAME), "full": dict(SAME), "extras": dict(SAME)}
        self.sweep = (0, SWEEP_OK)
        self.extras_sweep = (0, SWEEP_EXTRAS_OK)

    def install(self, monkeypatch):
        monkeypatch.setattr(tiers, "inspect", lambda image: self.infos[image])
        monkeypatch.setattr(tiers, "tools_present", lambda image: self.tools[image])
        monkeypatch.setattr(tiers, "content_digests", lambda image: self.digests[image])

        class Done:
            def __init__(self, rc, out):
                self.returncode, self.stdout, self.stderr = rc, out, ""

        monkeypatch.setattr(tiers, "run_in", lambda image, script: Done(*(self.extras_sweep if image == "extras" else self.sweep)))


def tags(fails):
    return sorted({line.split("]")[0].split("[")[1] for line in fails})


def test_two_good_images_pass(monkeypatch):
    world = World()
    world.install(monkeypatch)
    assert tiers.check("core", "full", REVISION) == []


def test_a_wrong_tier_is_caught_on_either_image(monkeypatch):
    for name, wrong in (("core", "full"), ("full", "core")):
        world = World()
        world.infos[name] = info(wrong, world.infos[name]["Size"])
        world.install(monkeypatch)
        assert "tier" in tags(tiers.check("core", "full", None)), name


def test_a_tool_in_core_or_missing_from_full_is_caught(monkeypatch):
    world = World()
    world.tools["core"] = {"chromium"}
    world.tools["full"] = set(tiers.TOOLS) - {"pandoc"}
    world.install(monkeypatch)
    fails = tiers.check("core", "full", None)
    assert any("chromium is in the core" in line for line in fails)
    assert any("pandoc is missing from the full" in line for line in fails)


def test_the_core_sweep_must_be_clean_and_all_not_installed(monkeypatch):
    for sweep in ((1, SWEEP_OK), (0, json.dumps({"tools": {"x": {"status": "OK"}}})), (0, "not json"), (0, "{}")):
        world = World()
        world.sweep = sweep
        world.install(monkeypatch)
        assert "sweep" in tags(tiers.check("core", "full", None)), sweep


def test_the_two_images_must_carry_the_same_commit(monkeypatch):
    world = World()
    world.infos["core"] = info("core", 600, "b" * 40)
    world.install(monkeypatch)
    assert "revision" in tags(tiers.check("core", "full", None))
    world = World()
    world.install(monkeypatch)
    assert "revision" in tags(tiers.check("core", "full", "c" * 40)), "the expected commit is checked when given"
    world = World()
    world.infos["core"] = info("core", 600, "")
    world.infos["full"] = info("full", 2000, "")
    world.install(monkeypatch)
    assert "revision" in tags(tiers.check("core", "full", None)), "no label on both is not 'equal'"


def test_any_difference_in_code_pi_users_or_links_is_caught(monkeypatch):
    for key in SAME:
        world = World()
        world.digests["full"][key] = "different"
        world.install(monkeypatch)
        fails = tiers.check("core", "full", None)
        assert any(key in line and "[content]" in line for line in fails), key


def test_an_empty_probe_is_a_failure_not_a_pass():
    assert tiers.compare({}, {}) == ["FAIL [content] the probe printed nothing"]


def test_a_core_that_grew_back_is_caught(monkeypatch):
    world = World()
    world.infos["core"] = info("core", 1500)
    world.install(monkeypatch)
    assert "size" in tags(tiers.check("core", "full", None))


def test_the_env_reader_takes_the_exact_name():
    assert tiers.env_value({"Config": {"Env": ["XJHT_IMAGE_TIER=full", "JHT_IMAGE_TIER=core"]}}, "JHT_IMAGE_TIER") == "core"
    assert tiers.env_value({"Config": {}}, "JHT_IMAGE_TIER") is None


def test_the_engine_is_docker_unless_the_machine_says_otherwise(monkeypatch):
    seen = []
    monkeypatch.setattr(tiers.subprocess, "run", lambda command, **kw: seen.append(command) or type("R", (), {"returncode": 0, "stdout": "[]", "stderr": ""})())
    tiers.docker("image", "inspect", "x")
    monkeypatch.setattr(tiers, "ENGINE", "podman")
    tiers.docker("image", "inspect", "x")
    assert [command[0] for command in seen] == ["docker", "podman"]


def run_extras(monkeypatch, world):
    world.install(monkeypatch)
    return tiers.check("core", "full", REVISION, "extras")


def test_three_good_images_pass(monkeypatch):
    assert run_extras(monkeypatch, World()) == []


def test_the_extras_image_must_say_extras(monkeypatch):
    world = World()
    world.infos["extras"] = info("full", 1200)
    assert tags(run_extras(monkeypatch, world)) == ["tier"]


def test_the_extras_image_has_the_three_tools_and_not_the_cv_pdf_ones(monkeypatch):
    world = World()
    world.tools["extras"] = set(tiers.EXTRAS_TOOLS) - {"ffmpeg"}
    fails = run_extras(monkeypatch, world)
    assert tags(fails) == ["tools"] and "ffmpeg is missing from the extras image" in fails[0]
    world = World()
    world.tools["extras"] = set(tiers.EXTRAS_TOOLS) | {"pandoc"}
    fails = run_extras(monkeypatch, world)
    assert tags(fails) == ["tools"] and "pandoc is in the extras image" in fails[0]


def test_the_extras_sweep_must_leave_only_the_manual_login_browser_to_check(monkeypatch):
    world = World()
    world.extras_sweep = (0, json.dumps({"tools": {"playwright_browser": {"status": "NOT_INSTALLED"}, "manual_login_browser": {"status": "OK"}}}))
    assert tags(run_extras(monkeypatch, world)) == ["sweep"]
    world = World()
    world.extras_sweep = (1, SWEEP_EXTRAS_OK)
    assert tags(run_extras(monkeypatch, world)) == ["sweep"]


def test_the_extras_image_carries_the_same_commit_and_the_same_code(monkeypatch):
    world = World()
    world.infos["extras"] = info("extras", 1200, revision="b" * 40)
    assert tags(run_extras(monkeypatch, world)) == ["revision"]
    world = World()
    world.digests["extras"] = {**SAME, "pi-bytes": "other"}
    fails = run_extras(monkeypatch, world)
    assert tags(fails) == ["content"] and "pi-bytes differs between core and extras" in fails[0]


def test_the_extras_image_is_smaller_than_the_full_one(monkeypatch):
    world = World()
    world.infos["extras"] = info("extras", 2000)
    assert tags(run_extras(monkeypatch, world)) == ["size"]
