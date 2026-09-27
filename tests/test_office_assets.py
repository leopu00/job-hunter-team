"""scripts/office_assets/build_office_assets.py: the desktop office's layout comes from game/.

The layout is rebuilt from the GDScript constants and compared with the
committed desktop/public/office/layout.json: when the Godot office moves a desk
and nobody runs the script, this goes red. Needs no image library.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "office_assets"))

import build_office_assets as assets  # noqa: E402

OFFICE = ROOT / "desktop" / "public" / "office"


@pytest.fixture(scope="module")
def committed() -> dict:
    return json.loads((OFFICE / "layout.json").read_text(encoding="utf-8"))


def test_the_committed_layout_is_what_game_says_today(committed):
    layout, _ = assets.build_layout(assets.ArtPlan())
    assert layout == committed, "game/ changed: run python3 scripts/office_assets/build_office_assets.py"


def test_every_image_the_layout_and_the_manifest_name_is_shipped(committed):
    manifest = json.loads((OFFICE / "manifest.json").read_text(encoding="utf-8"))
    refs = [committed["floorImage"], committed["paperPile"]["image"]] + [b["image"] for b in committed["backdrop"]]
    items = committed["furniture"] + [d["furniture"] for dept in committed["departments"] for d in dept["desks"]]
    for item in items:
        refs += [ref for ref in (item["image"], item.get("occupiedImage")) if ref]
    for character in manifest["characters"]:
        refs += [sheet for sheet in (character["main"], character["sit"]) if sheet]
    assert len(refs) > 50
    missing = [ref["src"] for ref in refs if not (OFFICE / ref["src"].removeprefix("/office/")).is_file()]
    assert missing == []
    # And the other way: nothing is shipped that nobody names (the pre-commit
    # hook lets WebP in under desktop/public/office/ on this promise).
    named = {ref["src"] for ref in refs}
    shipped = {"/office/" + p.relative_to(OFFICE).as_posix() for p in OFFICE.rglob("*") if p.is_file() and p.suffix != ".json"}
    assert shipped - named == set()
    assert manifest["layout"] == "/office/layout.json"


def test_the_layout_has_the_offices_shape(committed):
    assert [d["id"] for d in committed["departments"]] == ["scout", "analisti", "scorer", "scrittori", "critici"]
    assert all(len(d["desks"]) == 6 for d in committed["departments"])
    assert [d["role"] for d in committed["departments"]] == ["scout", "analista", "scorer", "scrittore", "critico"]
    assert {c["role"] for c in committed["coreSeats"]} >= {"capitano", "sentinella", "assistente", "mentor"}
    assert set(committed["sheets"]) == {"capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor"}
    assert committed["nav"]["cell"] == 32 and len(committed["nav"]["walls"]) == 13
    assert committed["pois"]["printer"] == {"x": 1265.0, "y": 300.0}
    # Rugs lie under everyone and block nobody.
    rugs = [i for i in committed["furniture"] if i["kind"] == "rug"]
    assert len(rugs) == 6 and all(r["layer"] == "floor" and not r["blocking"] for r in rugs)
    # office_floor.gd: the glass band above the wall, the wall tiled on the floor's north edge.
    glass, wall = committed["backdrop"]
    assert wall["repeatX"] is True and wall["draw"] == {"x": 240.0, "y": 20.0, "w": 2920.0, "h": 120.0}
    assert glass["draw"]["y"] + glass["draw"]["h"] == wall["draw"]["y"]
    # glass_partition.gd: one pane per GLASS_WALL, 172 tall, standing on the wall's centre line.
    panes = [i for i in committed["furniture"] if i["kind"] == "glass_partition"]
    assert len(panes) == len(committed["nav"]["walls"]) and not any(p["blocking"] for p in panes)
    first, wall0 = panes[0], committed["nav"]["walls"][0]
    assert first["draw"]["h"] == 172.0 and first["draw"]["y"] + 172.0 == wall0["y"] + wall0["h"] / 2


def test_a_desks_seat_is_the_standing_point_of_desk_spot(committed):
    scout = committed["departments"][0]["desks"]
    # Rect2(690, 346, 170, 78) facing up: (centre.x, end.y + 24).
    assert scout[2]["seat"] == {"x": 775.0, "y": 448.0}
    # Rect2(690, 689, 170, 78) facing down: (centre.x, y - 14).
    assert scout[3]["seat"] == {"x": 775.0, "y": 675.0}
    # agent_npc.gd _seat_offset: the desk's own, else by facing.
    assert scout[5]["seatOffset"] == {"x": 41.0, "y": -71.0}  # "right" drawn down_right: its own offset
    assert scout[3]["seatOffset"] == {"x": 0.0, "y": 95.0}  # "down", from the table
    core = {c["role"]: c for c in committed["coreSeats"]}
    assert core["mentor"]["seatOffset"] == {"x": 0.0, "y": -24.0}
    assert core["capitano"]["seatOffset"] == {"x": 0.0, "y": 95.0}


def test_art_is_placed_by_godots_rule_and_mirrored_where_godot_mirrors_it(committed):
    by_id = {i["id"]: i for i in committed["furniture"]}
    printer = by_id["printer"]  # Rect2(1218, 185, 95, 70)
    assert printer["draw"]["w"] == pytest.approx(95 * 1.06)
    assert printer["draw"]["y"] + printer["draw"]["h"] == pytest.approx(185 + 70 + 10)
    assert by_id["wb_scorer"]["flip"] is True
    assert "flip" not in by_id["wb_analisti"]
    desks = {d["furniture"]["id"]: d["furniture"] for dept in committed["departments"] for d in dept["desks"]}
    assert desks["desk_scout_1"]["flip"] is True  # down_left: the _diag_down art mirrored
    assert desks["desk_scout_1"]["image"]["src"].endswith("scout_a_diag_down.png")
    # front_occlusion: only the five "down" desks at six o'clock carry it, with their own fraction.
    occluded = {k: v["frontOcclusion"] for k, v in desks.items() if "frontOcclusion" in v}
    assert sorted(occluded.values()) == [0.62, 0.72, 0.72, 0.78, 0.8]
    assert all(k.endswith("_3") for k in occluded)


def test_gdscript_literals_are_read_and_expressions_are_skipped(tmp_path: Path):
    source = tmp_path / "defs.gd"
    source.write_text(
        "\n".join(
            [
                "class_name Defs",
                'const DIR := "res://x"  # a comment with Rect2(0, 0, 0, 0)',
                "const R := Rect2(1, 2.5, 3, 4)",
                "const ITEMS := [",
                '\t{"id": "a#1", "at": Vector2(5, 6),  # the id keeps its #',
                '\t\t"c": Color("#00e87a"), "on": true, "path": DIR + "/y.png"},',
                "]",
                "const NODE := preload(\"res://n.gd\")",
                "const TYPED: float = 32.0",
                "const CONTINUED := \\",
                '\t\t"res://on/the/next/line.png"',
            ]
        )
    )
    values = assets.gd_constants(source)
    assert values["R"] == {"x": 1.0, "y": 2.5, "w": 3.0, "h": 4.0}
    assert values["ITEMS"] == [{"id": "a#1", "at": {"x": 5.0, "y": 6.0}, "c": "#00e87a", "on": True, "path": "res://x/y.png"}]
    assert values["TYPED"] == 32.0
    assert values["CONTINUED"] == "res://on/the/next/line.png"
    assert "NODE" not in values


def test_every_sheet_a_role_wears_is_in_the_manifest_at_half_size(committed):
    manifest = json.loads((OFFICE / "manifest.json").read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in manifest["characters"]}
    worn = {sheet for sheets in committed["sheets"].values() for sheet in sheets}
    assert worn <= set(by_id), worn - set(by_id)
    main = by_id["scout_a"]["main"]
    # Half the Godot sheet: a cell and the feet in the shipped pixels, and a scale
    # that still draws a cell at 256 * 0.425 world pixels.
    assert (main["cols"], main["rows"], main["cell"], main["feet"]) == (6, 12, {"w": 128, "h": 192}, {"x": 64.0, "y": 180.0})
    assert main["cell"]["w"] * main["scale"] == pytest.approx(256 * 0.425)
    assert by_id["scout_a"]["sit"]["cols"] == 4 and by_id["scout_a"]["sit"]["rows"] == 3


def test_the_departments_carry_their_labels_and_the_handoff_tags(committed):
    scout, *_, critici = committed["departments"]
    # department_dressing.gd: bottom-left of the zone Rect2(320, 348, 880, 520).
    assert scout["tagline"] == "Finds relevant opportunities for you."
    assert scout["labelPos"] == {"x": 338.0, "y": 834.0}
    # handoff_station.gd: the tag names the department that fetches from this one.
    assert scout["handoff"] == {
        "label": "RESEARCH  →  ANALYSIS",
        "labelPos": {"x": 1080.0, "y": 816.0},
        "pileSpot": {"x": 1080.0, "y": 692.0},
    }
    assert "handoff" not in critici  # the last of the chain hands to the output shelf
    pile = committed["paperPile"]
    assert (pile["width"], pile["perStack"], pile["maxStacks"], pile["columns"]) == (38.0, 40, 12, 6)
    assert pile["image"]["src"].endswith("paper_pile_1.png")
