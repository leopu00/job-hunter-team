"""Synthetic profile scope is independent of the title, portal country and languages."""
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
import linkedin_access as access
from scout_search_scope import ScopeError, from_profile, read_scope


@pytest.fixture
def profile(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    path = tmp_path / "profile/candidate_profile.yml"
    path.parent.mkdir()
    data = {"name": "Synthetic Candidate", "target_role": "Data Analyst", "location": "Milano",
            "preferences": {"work_mode": "ibrido", "relocation": False},
            "languages": [{"language": "Italian", "level": "native"}, {"language": "English", "level": "C1"}]}
    path.write_text(yaml.safe_dump(data))
    return path, data


def test_scope_uses_declared_location_and_preferences_without_deriving_a_country(profile):
    path, data = profile
    scope = read_scope(path)
    assert scope.places == ("Milano",) and scope.select() == "Milano"
    assert scope.work_mode == "ibrido" and scope.relocation is False
    assert scope.select("Milan") == "Milano"
    with pytest.raises(ScopeError, match="scout_search_scope_conflict"):
        scope.select("Dublin")
    data["languages"] = [{"language": "Swedish", "level": "native"}]
    assert from_profile(data) == scope


def test_named_preferences_take_priority_over_residence_and_preserve_qualified_place(profile):
    _, data = profile
    data["location_preferences"] = ["Torino, Italia", "Milano, Italia"]
    scope = from_profile(data)
    assert scope.select() == "Torino, Italia"
    assert scope.select("Milan, Italia") == "Milano, Italia"
    with pytest.raises(ScopeError):
        scope.select("Milano, Texas")


def test_permission_to_relocate_does_not_automatically_change_the_primary_area(profile):
    _, data = profile
    data["preferences"]["relocation"] = ["Berlin"]
    assert from_profile(data).select() == "Milano"
    with pytest.raises(ScopeError):
        from_profile(data).select("Berlin")


def test_every_page_keeps_profile_area_independent_of_role_keywords_and_source_country(profile, monkeypatch, capsys):
    path, _ = profile
    urls = []
    card = '<div class="base-card" data-entity-urn="urn:li:jobPosting:101"><h3>Fictional role</h3></div>'

    def get(url, **kwargs):
        from types import SimpleNamespace
        urls.append(parse_qs(urlparse(url).query))
        return SimpleNamespace(status_code=200, text=card if len(urls) == 1 else ""), None

    monkeypatch.setattr(access, "_get", get)
    monkeypatch.setattr(access.time, "sleep", lambda seconds: None)
    assert access.main(["search", "--profile", str(path), "--keywords", "data", "--country", "ie"]) == 0
    assert [query["location"] for query in urls] == [["Milano"], ["Milano"]]
    assert [query["keywords"] for query in urls] == [["data"], ["data"]]
    assert [query["start"] for query in urls] == [["0"], ["25"]]
    assert all("geoId" not in query for query in urls)
    assert json.loads(capsys.readouterr().out)["job_id"] == "101"


@pytest.mark.parametrize("kind", ["missing", "invalid", "oversized", "link", "fifo"])
def test_bad_profile_is_an_explicit_failure_before_any_network_request(profile, monkeypatch, capsys, kind):
    import os
    path, _ = profile
    path.unlink()
    if kind == "invalid":
        path.write_text("preferences: [broken")
    elif kind == "oversized":
        path.write_text("x" * (64 * 1024 + 1))
    elif kind == "link":
        target = path.parent / "other.yml"
        target.write_text("location: Milano")
        path.symlink_to(target)
    elif kind == "fifo":
        os.mkfifo(path)
    monkeypatch.setattr(access, "_get", lambda *a, **kw: pytest.fail("network must not be called"))
    assert access.main(["search", "--profile", str(path), "--keywords", "data"]) == 4
    assert json.loads(capsys.readouterr().out)["code"] == "scout_search_scope_unavailable"
    assert "scout_search_scope_unavailable" in (path.parents[1] / "logs/runtime.log").read_text()


def test_a_conflicting_location_cannot_override_the_profile(profile, monkeypatch, capsys):
    path, _ = profile
    monkeypatch.setattr(access, "_get", lambda *a, **kw: pytest.fail("network must not be called"))
    assert access.main(["search", "--profile", str(path), "--keywords", "data", "--location", "Dublin"]) == 4
    assert json.loads(capsys.readouterr().out)["code"] == "scout_search_scope_conflict"
