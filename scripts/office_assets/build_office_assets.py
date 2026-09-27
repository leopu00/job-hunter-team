#!/usr/bin/env python3
"""The desktop office's assets (D05), built from the Godot office in game/.

    python3 scripts/office_assets/build_office_assets.py            # layout + floor + furniture + characters
    python3 scripts/office_assets/build_office_assets.py --no-characters

Reads game/ and never writes there. Writes desktop/public/office/:

- layout.json    the OfficeLayout of desktop/src/office/contract.ts, from the
                 constants of game/scripts/office/{furniture,department}_defs.gd,
                 characters/character_defs.gd and the few scripts that place art
                 (dept_rugs.gd, handoff_station.gd, output_shelf.gd, office.gd);
- manifest.json  the OfficeManifest: the layout's URL and the character sheets;
- the art, recompressed: 1 image pixel per world pixel at most, never more
                 than the source has. PNG with a 256-colour palette and alpha
                 (as light as WebP here, and the repository's hooks take PNG),
                 JPEG for the opaque floor.

The layout is read from the GDScript constants themselves (a small literal
parser, below), not copied by hand: when the Godot office moves a desk, running
this again moves it here. Where Godot places art with a rule of its own
(furniture_node.gd, handoff_station.gd, dept_rugs.gd), the rule is applied here
and the result is a `draw` rectangle in world pixels, so the scene draws an
image into a rectangle and knows no Godot rule.

Writing the images needs Pillow; the layout alone does not, so its test runs
wherever pytest does.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GAME = ROOT / "game"
OUT = ROOT / "desktop" / "public" / "office"

JPEG_QUALITY = 82
PALETTE = 256
# The Godot rig draws a 256x384 cell at 0.425; half the sheet keeps ~1.2 image
# pixels per world pixel for the characters, who are what the eye follows.
SHEET_FACTOR = 0.5
RIG_SCALE = 0.425
SHEET_CELL = (256, 384)
SHEET_FEET = (128, 360)

# furniture_node.gd: the art is 106% of the rect's width, its bottom 10 px below the rect.
ART_WIDTH = 1.06
ART_DROP = 10.0

# ─── GDScript constants ─────────────────────────────────────────────────


def _strip_comments(source: str) -> str:
    out = []
    for line in source.splitlines():
        in_string = False
        quote = ""
        cut = len(line)
        for i, ch in enumerate(line):
            if in_string:
                if ch == quote and line[i - 1] != "\\":
                    in_string = False
            elif ch in "\"'":
                in_string, quote = True, ch
            elif ch == "#":
                cut = i
                break
        out.append(line[:cut])
    return "\n".join(out)


def _balanced_end(text: str, start: int) -> int:
    """The end of the expression starting at `start`: brackets balanced, then the line ends."""
    depth = 0
    in_string = False
    quote = ""
    i = start
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == quote and text[i - 1] != "\\":
                in_string = False
        elif ch in "\"'":
            in_string, quote = True, ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "\n" and depth == 0:
            return i
        i += 1
    return i


def rect(x, y, w, h):
    return {"x": float(x), "y": float(y), "w": float(w), "h": float(h)}


def vec(x, y):
    return {"x": float(x), "y": float(y)}


def color(*args):
    if len(args) == 1 and isinstance(args[0], str):
        return args[0]
    r, g, b = (round(float(c) * 255) for c in args[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def gd_constants(path: Path, known: dict | None = None) -> dict:
    """The `const NAME := literal` of a GDScript file, as Python values.

    Rect2 -> {x, y, w, h}, Vector2 -> {x, y}, Color -> "#rrggbb". A constant
    that is not a literal (a call, an expression over nodes) is skipped.
    """
    text = _strip_comments(path.read_text(encoding="utf-8"))
    env = {"Rect2": rect, "Vector2": vec, "Color": color, "true": True, "false": False, "null": None, **(known or {})}
    values: dict = {}
    for match in re.finditer(r"^const\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*[A-Za-z0-9_\[\]]+)?\s*:?=\s*", text, re.M):
        end = _balanced_end(text, match.end())
        expr = text[match.end() : end].strip()
        try:
            values[match.group(1)] = eval(expr, {"__builtins__": {}}, {**env, **values})  # noqa: S307 - our own repo's literals
        except Exception:
            continue
    return values


# ─── Layout ─────────────────────────────────────────────────────────────


def res(path: str) -> Path:
    """A res:// path of the Godot project, on disk."""
    return GAME / path.removeprefix("res://")


@dataclass
class Art:
    """An image the layout uses, and the widest it is drawn at, in world pixels."""

    source: Path
    url: str
    width: float = 0.0


class ArtPlan:
    def __init__(self) -> None:
        self.items: dict[Path, Art] = {}

    def use(self, source: Path, folder: str, width: float, ext: str = "png") -> str:
        art = self.items.get(source)
        if art is None:
            art = Art(source, f"/office/{folder}/{source.stem}.{ext}")
            self.items[source] = art
        art.width = max(art.width, width)
        return art.url


def _size(path: Path) -> tuple[int, int]:
    """A PNG's width and height, from its IHDR header: no image library needed for the layout."""
    with path.open("rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise ValueError(f"{path}: not a PNG")
    return struct.unpack(">II", head[16:24])


def standing_draw(r: dict, tex: tuple[int, int]) -> dict:
    """furniture_node.gd: width rect.w * 1.06, centred, bottom at rect.end.y + 10."""
    w = r["w"] * ART_WIDTH
    h = tex[1] * w / tex[0]
    cx = r["x"] + r["w"] / 2
    bottom = r["y"] + r["h"] + ART_DROP
    return rect(cx - w / 2, bottom - h, w, h)


def furniture_texture(kind: str, facing: str, gen_art: dict) -> tuple[Path | None, bool]:
    """FurnitureNode._ready: the oriented variant first, then GEN_ART, then <kind>.png."""
    flip = False
    folder = GAME / "assets" / "gen-art" / "furniture"
    if facing:
        suffix = {"up": "up", "down_right": "diag_down", "down_left": "diag_down", "left": "side", "right": "side"}.get(facing, "down")
        flip = facing in ("down_left", "right")
        oriented = folder / f"{kind}_{suffix}.png"
        if oriented.exists():
            return oriented, flip
    if kind in gen_art and res(gen_art[kind]).exists():
        return res(gen_art[kind]), False
    direct = folder / f"{kind}.png"
    return (direct, False) if direct.exists() else (None, False)


def seated_texture(item: dict, base: Path | None) -> Path | None:
    """The art with the agent seated: an explicit path, or <base>_seated_v2 / _seated, on the same canvas."""
    if base is None:
        return None
    candidates = [res(item["seated_art"])] if item.get("seated_art") else [
        base.with_name(base.stem + "_seated_v2.png"),
        base.with_name(base.stem + "_seated.png"),
    ]
    for path in candidates:
        if path.exists() and _size(path) == _size(base):
            return path
    return None


def furniture_item(item: dict, plan: ArtPlan, gen_art: dict, *, id: str, seat_of: str | None = None) -> dict:
    kind = item["kind"]
    facing = item.get("tex_facing", item.get("facing", ""))
    source, flip = furniture_texture(kind, facing, gen_art)
    flip = flip or bool(item.get("flip_h", False))
    out: dict = {"id": id, "kind": kind, "rect": item["rect"], "blocking": not item.get("non_blocking", False)}
    if item.get("facing") in ("down", "up", "left", "right"):
        out["facing"] = item["facing"]
    if source is None:
        out["image"] = None
    else:
        draw = standing_draw(item["rect"], _size(source))
        out["image"] = {"src": plan.use(source, "furniture", draw["w"])}
        out["draw"] = draw
        if flip:
            out["flip"] = True
        seated = seated_texture(item, source)
        if seated is not None:
            out["occupiedImage"] = {"src": plan.use(seated, "furniture/occupied", draw["w"])}
    if seat_of:
        out["seatOf"] = seat_of
    return out


# Godot slugs -> the contract's AgentRole. Roles the contract does not name
# (dottore, mantenitore) keep their furniture but get no seat.
ROLE_OF_SLUG = {
    "coordinatore": "capitano",
    "scout": "scout",
    "analista": "analista",
    "scorer": "scorer",
    "scrittore": "scrittore",
    "critico": "critico",
    "sentinella": "sentinella",
    "assistente": "assistente",
    "mentor": "mentor",
}


def desk_spot(desk: dict) -> dict:
    """DepartmentDefs.desk_spot."""
    r = desk["rect"]
    facing = desk.get("facing", "down")
    if facing == "up":
        return vec(r["x"] + r["w"] / 2, r["y"] + r["h"] + 24)
    if facing == "left":
        return vec(r["x"] + r["w"] + 14, r["y"] + r["h"] + 6)
    if facing == "right":
        return vec(r["x"] - 14, r["y"] + r["h"] + 6)
    return vec(r["x"] + r["w"] / 2, r["y"] - 14)


def build_layout(plan: ArtPlan) -> tuple[dict, list[str]]:
    office = GAME / "scripts" / "office"
    furniture = gd_constants(office / "furniture_defs.gd")
    departments = gd_constants(office / "department_defs.gd")
    node = gd_constants(office / "furniture_node.gd")
    rugs_dir = gd_constants(office / "dept_rugs.gd")
    handoff = gd_constants(office / "handoff_station.gd")
    shelf = gd_constants(office / "output_shelf.gd")
    main = gd_constants(office / "office.gd")
    characters = gd_constants(GAME / "scripts" / "characters" / "character_defs.gd")
    gen_art = node["GEN_ART"]

    agents = characters["AGENTS"]
    dept_roles = characters["DEPT_ROLES"]
    core_seat_of = {
        a.get("workstation_key"): ROLE_OF_SLUG[slug] for slug, a in agents.items() if slug in ROLE_OF_SLUG and a.get("workstation_key")
    }

    items: list[dict] = []
    # Rugs first: under everything, walked on.
    for dept_id, (centre, size, path) in rugs_dir["RUGS"].items():
        r = rect(centre["x"] - size["x"] / 2, centre["y"] - size["y"] / 2, size["x"], size["y"])
        items.append({
            "id": f"rug_{dept_id}", "kind": "rug", "rect": r, "blocking": False, "layer": "floor",
            "image": {"src": plan.use(res(path), "furniture", r["w"])}, "draw": r,
        })
    for item in furniture["ITEMS"]:
        items.append(furniture_item(item, plan, gen_art, id=item["id"], seat_of=core_seat_of.get(item.get("registry_key"))))

    depts: list[dict] = []
    for dept_id in departments["DEPT_ORDER"]:
        d = departments["DEPARTMENTS"][dept_id]
        desks = []
        for index, desk in enumerate(d["desks"]):
            desks.append({
                "index": index,
                "furniture": furniture_item(desk, plan, gen_art, id=f"desk_{dept_id}_{index}"),
                "seat": desk_spot(desk),
                "seatFacing": desk.get("facing", "down"),
            })
        inbox = d["inbox"]
        depts.append({
            "id": dept_id,
            "role": ROLE_OF_SLUG[dept_roles[dept_id]["slug"]],
            "name": d["name"],
            "color": d["color"],
            "zone": d["zone"],
            "inbox": inbox,
            "inboxDropAccess": d.get("inbox_drop_access", d.get("inbox_access", inbox)),
            "inboxPickupAccess": d.get("inbox_pickup_access", d.get("inbox_access", inbox)),
            "desks": desks,
        })
        # The handoff table: its A* footprint (DepartmentDefs.obstacles) is the
        # rect; the art is TABLE_WIDTH wide with its bottom on the inbox.
        if dept_id in departments["HANDOFF_DEPTS"]:
            size = departments["HANDOFF_SIZE"]
            footprint = rect(inbox["x"] - size["x"] / 2, inbox["y"] - size["y"], size["x"], size["y"])
            table: dict = {"id": f"handoff_{dept_id}", "kind": "handoff_table", "rect": footprint, "blocking": True, "image": None}
            path = handoff["TABLE_TEXTURES"].get(dept_id)
            if path and res(path).exists():
                tw, th = _size(res(path))
                w = handoff["TABLE_WIDTH"]
                h = th * w / tw
                table["draw"] = rect(inbox["x"] - w / 2, inbox["y"] - h, w, h)
                table["image"] = {"src": plan.use(res(path), "furniture", w)}
            items.append(table)

    # The output shelf is drawn in code in Godot: a plain block here.
    items.append({"id": "output_shelf", "kind": "output_shelf", "rect": shelf["RECT"], "blocking": True, "image": None})

    core_seats = []
    for slug, agent in agents.items():
        role = ROLE_OF_SLUG.get(slug)
        if role is None or "spot" not in agent:
            continue
        key = agent.get("workstation_key")
        furniture_id = next((i["id"] for i in furniture["ITEMS"] if i.get("registry_key") == key), "")
        core_seats.append({"role": role, "seat": agent["spot"], "seatFacing": agent.get("facing", "down"), "furnitureId": furniture_id})

    sheets: dict[str, list[str]] = {}
    for dept_id, variants in characters["VARIANT_BY_DESK"].items():
        slug = dept_roles[dept_id]["slug"]
        sheets[ROLE_OF_SLUG[slug]] = [f"{slug}_{variants[i]}" for i in sorted(variants)]
    for slug, role in ROLE_OF_SLUG.items():
        sheets.setdefault(role, [f"{characters.get('SHEET_LOANS', {}).get(slug, slug)}_a"])

    floor_png = GAME / "assets" / "gen-art" / "floor" / "floor_main.png"
    floor = furniture["FLOOR"]
    layout = {
        "version": 1,
        "world": furniture["WORLD"],
        "floor": floor,
        "floorImage": {"src": plan.use(floor_png, "floor", floor["w"], ext="jpg")},
        "furniture": items,
        "departments": depts,
        "coreSeats": core_seats,
        "door": main["EXIT_DOOR"],
        # DepartmentDefs.POIS.printer.spot, and OutputShelf.RECT's centre + (0, 46).
        "pois": {
            "printer": departments["POIS"]["printer"]["spot"],
            "outputShelf": vec(shelf["RECT"]["x"] + shelf["RECT"]["w"] / 2, shelf["RECT"]["y"] + shelf["RECT"]["h"] / 2 + 46),
        },
        "nav": {"cell": 32, "margin": 28, "wallMargin": 14, "walls": departments["GLASS_WALLS"]},
        "sheets": sheets,
    }
    nav = gd_constants(office / "nav_grid.gd")
    layout["nav"]["cell"], layout["nav"]["margin"], layout["nav"]["wallMargin"] = nav["CELL"], nav["MARGIN"], nav["WALL_MARGIN"]
    return layout, sorted({s for names in sheets.values() for s in names})


# ─── Images ─────────────────────────────────────────────────────────────


def write_image(source: Path, target: Path, width: int | None = None, size: tuple[int, int] | None = None) -> int:
    """Resized with Lanczos, then saved by the target's extension: .jpg opaque, .png as a palette with alpha."""
    from PIL import Image

    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert("RGBA")
        if size is None and width is not None and width < image.width:
            size = (width, max(1, round(image.height * width / image.width)))
        if size is not None and size != image.size:
            image = image.resize(size, Image.LANCZOS)
        if target.suffix == ".jpg":
            image.convert("RGB").save(target, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
        else:
            image.quantize(PALETTE, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(target, "PNG", optimize=True)
    return target.stat().st_size


def url_path(url: str) -> Path:
    return OUT / url.removeprefix("/office/")


def build_characters(slugs: list[str]) -> tuple[list[dict], int, int]:
    sheets_dir = GAME / "assets" / "characters" / "sheets"
    characters, before, after = [], 0, 0
    cell = {"w": round(SHEET_CELL[0] * SHEET_FACTOR), "h": round(SHEET_CELL[1] * SHEET_FACTOR)}
    feet = {"x": SHEET_FEET[0] * SHEET_FACTOR, "y": SHEET_FEET[1] * SHEET_FACTOR}
    scale = RIG_SCALE / SHEET_FACTOR
    for sheet in slugs:
        main = sheets_dir / f"{sheet}.png"
        if not main.exists():
            print(f"  no sheet for {sheet}: skipped", file=sys.stderr)
            continue
        slug = sheet.rsplit("_", 1)[0]
        sit = next((p for p in (sheets_dir / f"{sheet}_sit.png", sheets_dir / f"{slug}_sit.png") if p.exists()), None)
        entry: dict = {"id": sheet, "sit": None}
        for key, source, cols, rows in (("main", main, 6, 12), ("sit", sit, 4, 3)):
            if source is None:
                continue
            url = f"/office/characters/{source.stem}.png"
            before += source.stat().st_size
            after += write_image(source, url_path(url), size=(cols * cell["w"], rows * cell["h"]))
            entry[key] = {"src": url, "cols": cols, "rows": rows, "cell": cell, "feet": feet, "scale": scale}
        characters.append(entry)
    return characters, before, after


def human(n: int) -> str:
    return f"{n / 1_000_000:.1f} MB" if n >= 1_000_000 else f"{n / 1000:.0f} kB"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--no-characters", action="store_true", help="layout, floor and furniture only")
    args = parser.parse_args(argv)

    plan = ArtPlan()
    layout, sheet_slugs = build_layout(plan)
    OUT.mkdir(parents=True, exist_ok=True)

    before = after = 0
    for art in plan.items.values():
        before += art.source.stat().st_size
        after += write_image(art.source, url_path(art.url), width=max(1, round(art.width)))
    print(f"floor and furniture: {len(plan.items)} images, {human(before)} -> {human(after)}")

    characters: list[dict] = []
    if not args.no_characters:
        characters, cb, ca = build_characters(sheet_slugs)
        print(f"characters: {len(characters)} sheets, {human(cb)} -> {human(ca)}")
        before, after = before + cb, after + ca
    elif (OUT / "manifest.json").exists():
        characters = json.loads((OUT / "manifest.json").read_text())["characters"]

    (OUT / "layout.json").write_text(json.dumps(layout, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    manifest = {"version": 1, "layout": "/office/layout.json", "characters": characters, "atlases": []}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"total: {human(before)} -> {human(after)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
