// Pixi 8 compiles its shaders' uniform uploads with `new Function`, which the
// app's CSP (no 'unsafe-eval') refuses: this swaps in the eval-free versions.
import "pixi.js/unsafe-eval";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type {
  AgentPose,
  CharacterSheet,
  DeptId,
  FurnitureItem,
  ImageRef,
  OfficeScene,
  OfficeSceneOptions,
  Rect,
} from "../contract";
import { attachControls } from "./controls";
import { feetAnchor, pickCell } from "./frames";
import { allFurniture, sceneBounds } from "../layout-items";

/**
 * The office drawn with PixiJS in the webview: the floor, the furniture and
 * the agents y-sorted together (as Godot's YSort), the handoff piles with
 * their counts, the bubbles, and a camera moved as in the Godot game
 * (controls.ts: drag, trackpad, pinch, wheel, keys). What moves is the
 * engine's business: every frame the scene advances it and draws its poses;
 * it invents nothing. A click on an agent or on a pile goes to `onClick`; a
 * drag is not a click.
 */

const BACKGROUND = 0x0b0f14;

export async function createOfficeScene(host: HTMLElement, options: OfficeSceneOptions): Promise<OfficeScene> {
  const { manifest, layout, engine, onClick } = options;
  const app = new Application();
  await app.init({
    background: BACKGROUND,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    width: host.clientWidth || 800,
    height: host.clientHeight || 600,
    preference: "webgl",
  });
  host.appendChild(app.canvas);
  app.canvas.style.display = "block";

  const furniture = allFurniture(layout);
  const backdrop = layout.backdrop ?? [];
  const textures = await loadTextures(manifest, [layout.floorImage, ...backdrop.map((b) => b.image)], furniture);

  const world = new Container();
  const floorLayer = new Container();
  const sortedLayer = new Container();
  sortedLayer.sortableChildren = true;
  const overlay = new Container();
  world.addChild(floorLayer, sortedLayer, overlay);
  app.stage.addChild(world);

  // Behind the floor: the wall and the glass band, tiled or stretched.
  for (const item of backdrop) {
    const tex = textureFor(textures, item.image);
    if (!tex) continue;
    if (item.repeatX) {
      const tiles = new TilingSprite({ texture: tex, width: item.draw.w, height: item.draw.h });
      const k = item.draw.h / tex.height;
      tiles.tileScale.set(k, k);
      tiles.position.set(item.draw.x, item.draw.y);
      floorLayer.addChild(tiles);
    } else floorLayer.addChild(placed(new Sprite(tex), item.draw, false));
  }

  // Floor: the painted floor on its rect, or a plain one.
  const floorTex = textureFor(textures, layout.floorImage);
  if (floorTex) floorLayer.addChild(placed(new Sprite(floorTex), layout.floor, false));
  else floorLayer.addChild(new Graphics().rect(layout.floor.x, layout.floor.y, layout.floor.w, layout.floor.h).fill(0x1b2530));

  // The glass walls between departments (the navigation's walls), as Godot's glass lines.
  const glass = new Graphics();
  for (const w of layout.nav.walls) glass.rect(w.x, w.y, w.w, w.h);
  glass.fill({ color: 0x9fd4ff, alpha: 0.35 });
  floorLayer.addChild(glass);

  // Furniture with a seated picture: swapped in while someone sits there.
  type Occupiable = { sprite: Sprite; free: Texture; taken: Texture; occupant: { uid: string; role: AgentPose["role"] } | null };
  const occupiable = new Map<string, Occupiable>();
  for (const item of furniture) {
    const node = furnitureNode(item, textures);
    const free = textureFor(textures, item.image);
    const taken = textureFor(textures, item.occupiedImage);
    if (node instanceof Sprite && free && taken) {
      const entry: Occupiable = { sprite: node, free, taken, occupant: null };
      occupiable.set(item.id, entry);
      // While taken, the picture is the agent: a click on it is a click on the agent.
      clickable(node, () => entry.occupant && onClick({ kind: "agent", ...entry.occupant }));
      node.eventMode = "none";
    }
    if (item.layer === "floor") floorLayer.addChild(node);
    else sortedLayer.addChild(node);
  }

  const piles = new Map<DeptId, Text>();
  for (const dept of layout.departments) {
    const pile = new Container();
    pile.position.set(dept.inbox.x, dept.inbox.y);
    pile.addChild(new Graphics().roundRect(-22, -30, 44, 30, 4).fill({ color: dept.color, alpha: 0.85 }));
    const label = new Text({ text: "—", style: { fontFamily: "JetBrains Mono, monospace", fontSize: 16, fontWeight: "700", fill: 0x0b0f14 } });
    label.anchor.set(0.5, 0.5);
    label.position.set(0, -15);
    pile.addChild(label);
    pile.zIndex = dept.inbox.y;
    clickable(pile, () => onClick({ kind: "pile", dept: dept.id }));
    sortedLayer.addChild(pile);
    piles.set(dept.id, label);
  }

  // Camera: the controls (controls.ts) move it, the world follows.
  const bounds = sceneBounds(layout);
  const floorCentre = { x: layout.floor.x + layout.floor.w / 2, y: layout.floor.y + layout.floor.h / 2 };
  // The canvas takes the pointer and the wheel, not the page around it.
  app.canvas.style.touchAction = "none";
  const controls = attachControls(app.canvas, {
    view: { w: app.screen.width, h: app.screen.height },
    bounds,
    start: floorCentre,
    onChange: (camera) => {
      world.scale.set(camera.scale);
      world.position.set(camera.x, camera.y);
    },
  });

  function clickable(node: Container, action: () => void) {
    node.eventMode = "static";
    node.cursor = "pointer";
    node.on("pointertap", () => {
      if (!controls.dragging()) action();
    });
  }

  // Agents, bubbles, pile counts: every frame from the engine.
  const characters = new Map(manifest.characters.map((c) => [c.id, c]));
  const agents = new Map<string, Sprite>();
  const bubbles = new Map<string, { node: Container; text: string }>();

  const drawAgents = (poses: AgentPose[]) => {
    const seen = new Set<string>();
    const seated = new Map<string, AgentPose>();
    for (const pose of poses) {
      const character = characters.get(pose.sheet);
      if (!character) continue;
      seen.add(pose.uid);
      let sprite = agents.get(pose.uid);
      if (!sprite) {
        sprite = new Sprite();
        const role = pose.role;
        const uid = pose.uid;
        clickable(sprite, () => onClick({ kind: "agent", uid, role }));
        agents.set(pose.uid, sprite);
        sortedLayer.addChild(sprite);
      }
      drawPose(sprite, pose, character, textures);
      // Seated where the furniture has the seated picture: the picture is the agent.
      if (pose.seatedAt && occupiable.has(pose.seatedAt)) {
        seated.set(pose.seatedAt, pose);
        sprite.visible = false;
      }
    }
    for (const [id, o] of occupiable) {
      const who = seated.get(id);
      o.sprite.texture = who ? o.taken : o.free;
      o.occupant = who ? { uid: who.uid, role: who.role } : null;
      o.sprite.eventMode = who ? "static" : "none";
    }
    for (const [uid, sprite] of agents) {
      if (seen.has(uid)) continue;
      sprite.destroy();
      agents.delete(uid);
    }
    return seen;
  };

  const drawBubbles = (poses: AgentPose[]) => {
    const where = new Map(poses.map((p) => [p.uid, p]));
    const live = new Set<string>();
    for (const b of engine.bubbles()) {
      const pose = where.get(b.uid);
      const sprite = agents.get(b.uid);
      if (!pose || !sprite) continue;
      live.add(b.uid);
      let entry = bubbles.get(b.uid);
      if (!entry || entry.text !== b.text) {
        entry?.node.destroy({ children: true });
        entry = { node: bubbleNode(b.text), text: b.text };
        bubbles.set(b.uid, entry);
        overlay.addChild(entry.node);
      }
      const top = sprite.getLocalBounds();
      entry.node.position.set(pose.pos.x, pose.pos.y + top.y * Math.abs(sprite.scale.y) - 8);
    }
    for (const [uid, entry] of bubbles) {
      if (live.has(uid)) continue;
      entry.node.destroy({ children: true });
      bubbles.delete(uid);
    }
  };

  const drawPiles = () => {
    const counts = engine.piles();
    for (const [dept, label] of piles) {
      const n = counts[dept];
      label.text = n == null ? "—" : String(n);
    }
  };

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    controls.step(dt);
    engine.step(dt);
    const poses = engine.poses();
    drawAgents(poses);
    drawBubbles(poses);
    drawPiles();
  });

  return {
    resize(width: number, height: number) {
      if (width <= 0 || height <= 0) return;
      app.renderer.resize(width, height);
      controls.resize({ w: width, h: height });
    },
    destroy() {
      controls.destroy();
      app.destroy(true, { children: true });
    },
  };
}

// ─── Textures ────────────────────────────────────────────────────────────

type Textures = Map<string, Texture>;

/** Loads every image the manifest and the layout name, once per file. */
async function loadTextures(
  manifest: OfficeSceneOptions["manifest"],
  images: ImageRef[],
  furniture: FurnitureItem[],
): Promise<Textures> {
  const srcs = new Set<string>(images.map((i) => i.src));
  for (const item of furniture) {
    if (item.image) srcs.add(item.image.src);
    if (item.occupiedImage) srcs.add(item.occupiedImage.src);
  }
  for (const c of manifest.characters) {
    srcs.add(c.main.src);
    if (c.sit) srcs.add(c.sit.src);
  }
  for (const a of manifest.atlases) srcs.add(a.src);
  const out: Textures = new Map();
  await Promise.all(
    [...srcs].map(async (src) => {
      try {
        out.set(src, await Assets.load<Texture>(src));
      } catch (error) {
        // A missing picture draws as a plain block, not a dead office.
        console.warn("[office] image not loaded:", src, error);
      }
    }),
  );
  // Atlas regions, as their own textures.
  for (const atlas of manifest.atlases) {
    const base = out.get(atlas.src);
    if (!base) continue;
    for (const [name, r] of Object.entries(atlas.frames)) {
      out.set(`${atlas.src}#${name}`, new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) }));
    }
  }
  return out;
}

function textureFor(textures: Textures, ref: ImageRef | null | undefined): Texture | null {
  if (!ref) return null;
  return textures.get(ref.frame ? `${ref.src}#${ref.frame}` : ref.src) ?? null;
}

const cellCache = new WeakMap<Texture, Map<string, Texture>>();

function cellTexture(base: Texture, cell: Rect): Texture {
  let cells = cellCache.get(base);
  if (!cells) cellCache.set(base, (cells = new Map()));
  const key = `${cell.x},${cell.y}`;
  let tex = cells.get(key);
  if (!tex) {
    tex = new Texture({ source: base.source, frame: new Rectangle(cell.x, cell.y, cell.w, cell.h) });
    cells.set(key, tex);
  }
  return tex;
}

// ─── Nodes ───────────────────────────────────────────────────────────────

/** A sprite stretched on a world rect, mirrored if asked. */
function placed(sprite: Sprite, rect: Rect, flip: boolean): Sprite {
  sprite.anchor.set(flip ? 1 : 0, 0);
  sprite.position.set(rect.x, rect.y);
  sprite.width = rect.w;
  sprite.height = rect.h;
  if (flip) sprite.scale.x = -Math.abs(sprite.scale.x);
  return sprite;
}

function furnitureNode(item: FurnitureItem, textures: Textures): Container {
  const where = item.draw ?? item.rect;
  const tex = textureFor(textures, item.image);
  const node: Container = tex
    ? placed(new Sprite(tex), where, Boolean(item.flip))
    : new Graphics().rect(item.rect.x, item.rect.y, item.rect.w, item.rect.h).fill({ color: 0x3a4654, alpha: 0.9 });
  node.zIndex = where.y + where.h;
  node.label = item.id;
  return node;
}

function drawPose(sprite: Sprite, pose: AgentPose, character: CharacterSheet, textures: Textures) {
  const pick = pickCell(pose, character);
  const base = textures.get(pick.sheet.src);
  if (!base) {
    sprite.visible = false;
    return;
  }
  sprite.visible = true;
  sprite.texture = cellTexture(base, pick.cell);
  const anchor = feetAnchor(pick.sheet);
  sprite.anchor.set(anchor.x, anchor.y);
  sprite.scale.set(pose.flipped ? -pick.sheet.scale : pick.sheet.scale, pick.sheet.scale);
  sprite.position.set(pose.pos.x, pose.pos.y);
  sprite.zIndex = pose.pos.y;
}

function bubbleNode(text: string): Container {
  const node = new Container();
  const label = new Text({
    text,
    style: { fontFamily: "JetBrains Mono, monospace", fontSize: 15, fill: 0x0b0f14, wordWrap: true, wordWrapWidth: 260 },
  });
  const pad = 8;
  const w = label.width + pad * 2;
  const h = label.height + pad * 2;
  node.addChild(new Graphics().roundRect(-w / 2, -h, w, h, 8).fill({ color: 0xf4f1e8, alpha: 0.95 }));
  label.position.set(-w / 2 + pad, -h + pad);
  node.addChild(label);
  return node;
}
