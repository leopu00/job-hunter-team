// Pixi 8 compiles its shaders' uniform uploads with `new Function`, which the
// app's CSP (no 'unsafe-eval') refuses: this swaps in the eval-free versions.
import "pixi.js/unsafe-eval";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import type {
  AgentPose,
  AgentStatuses,
  Department,
  Vec,
  CharacterSheet,
  DeptId,
  FurnitureItem,
  ImageRef,
  OfficeClick,
  OfficeScene,
  OfficeSceneOptions,
  Rect,
} from "../contract";
import { attachControls, elementPoint } from "./controls";
import { toWorld } from "./camera";
import { hitTest, layoutHits, sameTarget, type Hit } from "./hit";
import { sheetPlacements, towerHeight, type PaperRule } from "./paper";
import {
  doorLeaves,
  doorStep,
  hologramFrame,
  hologramGlobe,
  printerFrame,
  someoneNear,
  someoneStandsAt,
  tesseractPulse,
  tesseractRays,
} from "./effects";
import { feetAnchor, pickCell } from "./frames";
import { allFurniture, cameraBounds } from "../layout-items";
import { tagOf } from "../status";
import { boxLights, darkness, GRAIN_AMOUNT, LAMPS, lighting, localHour, outsideBands, vignetteAlpha, type Pool } from "./atmosphere";
import { RIG_SCALE } from "../contract";

/**
 * The office drawn with PixiJS in the webview: the floor, the furniture and
 * the agents y-sorted together (as Godot's YSort), the handoff piles with
 * their counts, the bubbles, and a camera moved as in the Godot game
 * (controls.ts: drag, trackpad, pinch, wheel, keys). What moves is the
 * engine's business: every frame the scene advances it and draws its poses;
 * it invents nothing. What is under the pointer is found by scene/hit.ts
 * (the Godot office's order): a click goes to `onClick`, the pointer's
 * target to `onHover`; a drag is not a click.
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
  const images = [layout.floorImage, ...backdrop.map((b) => b.image), ...(layout.paperPile ? [layout.paperPile.image] : [])];
  const textures = await loadTextures(manifest, images, furniture);

  const world = new Container();
  const outside = new Graphics();
  const floorLayer = new Container();
  const shadowLayer = new Container();
  const sortedLayer = new Container();
  sortedLayer.sortableChildren = true;
  const lightLayer = new Container();
  const overlay = new Container();
  world.addChild(outside, floorLayer, shadowLayer, sortedLayer, lightLayer, overlay);
  // The frame's grade (vignette, grain) sits over the world, in screen space.
  const grade = new Container();
  grade.eventMode = "none";
  app.stage.addChild(world, grade);

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
      // While taken, the picture is the agent: hit.ts treats its box as the agent's.
      node.eventMode = "none";
    }
    if (item.layer === "floor") floorLayer.addChild(node);
    else sortedLayer.addChild(node);
    if (item.kind === "glass_partition") sortedLayer.addChild(glassSheen(item.rect, node.zIndex + 0.1));
  }

  // Light: the tint of the hour, the band outside the box, lamps and daylight.
  const pools = { lamps: LAMPS.map((p) => poolSprite(p, lightLayer)), ...lightsOf(boxLights(layout.floor), lightLayer) };
  const applyLight = () => {
    const d = darkness(localHour());
    const l = lighting(d);
    world.tint = l.tint;
    outside.clear();
    for (const r of outsideBands(layout.world, layout.floor)) outside.rect(r.x, r.y, r.w, r.h);
    outside.fill(l.outside);
    for (const [sprite, base] of [...pools.lamps, ...pools.neon]) {
      sprite.alpha = base * l.lampFactor;
      sprite.visible = l.lampFactor > 0;
    }
    for (const [sprite, base] of pools.daylight) {
      sprite.alpha = base * l.dayFactor;
      sprite.visible = l.dayFactor > 0;
    }
  };
  applyLight();
  const lightTimer = window.setInterval(applyLight, 30_000);

  // ScreenGrade: the vignette stretched over the frame, and a light grain.
  const vignette = new Sprite(vignetteTexture());
  const grain = new TilingSprite({ texture: grainTexture(), width: 1, height: 1 });
  grain.alpha = GRAIN_AMOUNT;
  grade.addChild(vignette, grain);
  const sizeGrade = (w: number, h: number) => {
    vignette.width = w;
    vignette.height = h;
    grain.width = w;
    grain.height = h;
  };
  sizeGrade(app.screen.width, app.screen.height);

  // The departments' dressing (department_dressing.gd): tint, brackets, name.
  for (const dept of layout.departments) floorLayer.addChild(departmentDressing(dept));

  // The handoff tables' tags and piles: paper sheets with their count where
  // the layout says how (paper_pile.gd), a plain counter otherwise.
  const paper = layout.paperPile;
  const sheetTex = paper ? textureFor(textures, paper.image) : null;
  const piles = new Map<DeptId, (n: number | null) => void>();
  const pileNodes = new Map<DeptId, { node: Container; spot: Vec }>();
  for (const dept of layout.departments) {
    if (dept.handoff) sortedLayer.addChild(handoffTag(dept.handoff.label, dept.handoff.labelPos, dept.color, dept.inbox.y + 1));
    const spot = dept.handoff?.pileSpot ?? dept.inbox;
    const pile = new Container();
    pile.position.set(spot.x, spot.y);
    pile.zIndex = dept.inbox.y + 0.5;
    pileNodes.set(dept.id, { node: pile, spot });
    sortedLayer.addChild(pile);
    piles.set(dept.id, paper && sheetTex ? paperPile(pile, paper, sheetTex) : counterBadge(pile, dept.color));
  }

  // The box's edges (tesseract_edges.gd): additive rays from the floor's corners, pulsing.
  const edges = tesseractEdges(layout.floor);
  lightLayer.addChild(edges);

  // The hologram's meridians and beat over its painted globe (hologram.gd).
  const holoItem = furniture.find((f) => f.kind === "hologram");
  const holo = new Graphics();
  holo.eventMode = "none";
  if (holoItem) {
    const where = holoItem.draw ?? holoItem.rect;
    holo.zIndex = where.y + where.h + 0.05;
    sortedLayer.addChild(holo);
  }

  // The printer at work while an agent stands at it (printer_fx.gd).
  const printerItem = furniture.find((f) => f.kind === "printer");
  const printerFx = new Graphics();
  printerFx.eventMode = "none";
  if (printerItem) {
    printerFx.position.set(printerItem.rect.x + printerItem.rect.w / 2, printerItem.rect.y + printerItem.rect.h);
    const where = printerItem.draw ?? printerItem.rect;
    printerFx.zIndex = where.y + where.h + 0.05;
    sortedLayer.addChild(printerFx);
  }

  // The exit door, sliding open while someone passes (exit_door.gd).
  const door = exitDoor(layout.door);
  sortedLayer.addChild(door.node);

  // The desks' fronts over an agent seated at them without a seated picture.
  const occluders = new Map<string, Sprite>();
  for (const item of furniture) {
    if (item.frontOcclusion == null || occupiable.has(item.id)) continue;
    const tex = textureFor(textures, item.image);
    if (!tex) continue;
    const o = frontOccluder(item.draw ?? item.rect, tex, item.frontOcclusion, Boolean(item.flip));
    occluders.set(item.id, o);
    sortedLayer.addChild(o);
  }

  // Camera: the controls (controls.ts) move it, the world follows.
  const bounds = cameraBounds(layout);
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

  // What is under the pointer (hit.ts): the agents' and the piles' boxes as
  // they are drawn now, the layout's fixed targets, in world pixels.
  const fixedHits = layoutHits(layout);
  const roles = new Map<string, AgentPose["role"]>();
  const worldBox = (b: { x: number; y: number; width: number; height: number }) => {
    const c = controls.camera();
    return { x: (b.x - c.x) / c.scale, y: (b.y - c.y) / c.scale, w: b.width / c.scale, h: b.height / c.scale };
  };
  const targetAt = (screen: Vec): OfficeClick | null => {
    const agentHits: Hit[] = [];
    for (const [uid, sprite] of agents) {
      const role = roles.get(uid);
      if (sprite.visible && role) agentHits.push({ rect: worldBox(sprite.getBounds()), target: { kind: "agent", uid, role } });
    }
    for (const o of occupiable.values()) {
      if (o.occupant) agentHits.push({ rect: worldBox(o.sprite.getBounds()), target: { kind: "agent", ...o.occupant } });
    }
    const pileHits: Hit[] = [];
    for (const [dept, { node, spot }] of pileNodes) {
      const b = node.getBounds();
      const rect = b.width > 0 ? worldBox(b) : { x: spot.x - 40, y: spot.y - 60, w: 80, h: 70 };
      pileHits.push({ rect, target: { kind: "pile", dept } });
    }
    return hitTest(toWorld(controls.camera(), screen), { agents: agentHits, piles: pileHits, ...fixedHits });
  };
  let hovered: OfficeClick | null = null;
  const hover = (target: OfficeClick | null, at: Vec) => {
    app.canvas.style.cursor = target ? "pointer" : "";
    // while on a target the position goes too, so a tag can follow the pointer
    if (target || !sameTarget(target, hovered)) options.onHover?.(target, at);
    hovered = target;
  };
  const onPointerMove = (e: PointerEvent) => {
    const at = elementPoint(app.canvas, e);
    hover(controls.dragging() ? null : targetAt(at), at);
  };
  const onPointerLeave = (e: PointerEvent) => hover(null, elementPoint(app.canvas, e));
  const onCanvasClick = (e: MouseEvent) => {
    if (controls.dragging()) return;
    onClick(targetAt(elementPoint(app.canvas, e)));
  };
  app.canvas.addEventListener("pointermove", onPointerMove);
  app.canvas.addEventListener("pointerleave", onPointerLeave);
  app.canvas.addEventListener("click", onCanvasClick);

  // Agents, bubbles, pile counts: every frame from the engine.
  const characters = new Map(manifest.characters.map((c) => [c.id, c]));
  const agents = new Map<string, Sprite>();
  const shadows = new Map<string, Graphics>();
  const bubbles = new Map<string, { node: Container; text: string }>();
  // The status tags (AgentStateTag): what the box published, never guessed.
  let statuses: AgentStatuses | null = null;
  const tags = new Map<string, { node: Container; key: string }>();
  const drawTags = (poses: AgentPose[]) => {
    const live = new Set<string>();
    const now = Date.now();
    for (const pose of poses) {
      const status = statuses?.agents[pose.uid.toLowerCase()];
      const sprite = agents.get(pose.uid);
      if (!status || !sprite) continue;
      live.add(pose.uid);
      const { label, color } = tagOf(status, now);
      const key = `${label}|${color}`;
      let entry = tags.get(pose.uid);
      if (!entry || entry.key !== key) {
        entry?.node.destroy({ children: true });
        entry = { node: stateTag(label, color), key };
        tags.set(pose.uid, entry);
        overlay.addChild(entry.node);
      }
      // over the head: the cell's top above the feet, plus half the tag and 6 px (STATE_TAG_HEAD_CLEARANCE)
      const top = sprite.getLocalBounds().y * Math.abs(sprite.scale.y);
      entry.node.position.set(pose.pos.x, pose.pos.y + top - 18);
    }
    for (const [uid, entry] of tags) {
      if (live.has(uid)) continue;
      entry.node.destroy({ children: true });
      tags.delete(uid);
    }
  };

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
        agents.set(pose.uid, sprite);
        sortedLayer.addChild(sprite);
      }
      roles.set(pose.uid, pose.role);
      drawPose(sprite, pose, character, textures);
      let shadow = shadows.get(pose.uid);
      if (!shadow) {
        shadow = agentShadow();
        shadows.set(pose.uid, shadow);
        shadowLayer.addChild(shadow);
      }
      placeShadow(shadow, pose);
      // Seated where the furniture has the seated picture: the picture is the agent.
      if (pose.seatedAt && occupiable.has(pose.seatedAt)) {
        seated.set(pose.seatedAt, pose);
        sprite.visible = false;
      }
    }
    for (const [id, o] of occluders) {
      const who = poses.find((p) => p.seatedAt === id);
      o.visible = Boolean(who);
      if (who) o.zIndex = who.pos.y + 0.01;
    }
    for (const [id, o] of occupiable) {
      const who = seated.get(id);
      o.sprite.texture = who ? o.taken : o.free;
      o.occupant = who ? { uid: who.uid, role: who.role } : null;
    }
    for (const [uid, sprite] of agents) {
      if (seen.has(uid)) continue;
      sprite.destroy();
      agents.delete(uid);
      roles.delete(uid);
      shadows.get(uid)?.destroy();
      shadows.delete(uid);
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
    for (const [dept, show] of piles) show(counts[dept]);
  };

  let grainClock = 0;
  let clock = 0;
  let holoClock = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    // ScreenGrade's grain moves 9 times a second, like a dirty brush
    grainClock += dt;
    if (grainClock > 1 / 9) {
      grainClock = 0;
      grain.tilePosition.set(Math.random() * 256, Math.random() * 256);
    }
    controls.step(dt);
    engine.step(dt);
    clock += dt;
    edges.alpha = tesseractPulse(clock);
    // the hologram redraws at 20 Hz, as in Godot
    holoClock += dt;
    if (holoItem && holoClock >= 0.05) {
      holoClock = 0;
      drawHologram(holo, holoItem.rect, clock);
    }
    const poses = engine.poses();
    if (printerItem) drawPrinter(printerFx, printerItem.rect.w / 150, layout.pois && someoneStandsAt(poses, layout.pois.printer, 70) ? clock : null);
    door.step(someoneNear(poses, layout.door, 120), dt);
    drawAgents(poses);
    drawBubbles(poses);
    drawTags(poses);
    drawPiles();
  });

  return {
    setAgentStatuses(next: AgentStatuses | null) {
      statuses = next;
    },
    resize(width: number, height: number) {
      if (width <= 0 || height <= 0) return;
      app.renderer.resize(width, height);
      controls.resize({ w: width, h: height });
      sizeGrade(width, height);
    },
    destroy() {
      app.canvas.removeEventListener("pointermove", onPointerMove);
      app.canvas.removeEventListener("pointerleave", onPointerLeave);
      app.canvas.removeEventListener("click", onCanvasClick);
      window.clearInterval(lightTimer);
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

// ─── Light, glass and shadows ───────────────────────────────────────────

let poolTex: Texture | null = null;

/** LightPool's texture: a white radial gradient to transparent, 256 px, shared. */
function poolTexture(): Texture {
  if (poolTex) return poolTex;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  poolTex = Texture.from(c);
  return poolTex;
}

/** A light pool (light_pool.gd): additive, squashed, over the whole scene. Returns it with its base alpha. */
function poolSprite(p: Pool, layer: Container): [Sprite, number] {
  const s = new Sprite(poolTexture());
  s.anchor.set(0.5);
  s.position.set(p.pos.x, p.pos.y);
  s.scale.set((p.radius * 2) / 256, ((p.radius * 2) / 256) * p.squash);
  s.tint = (Math.round(p.color.r * 255) << 16) | (Math.round(p.color.g * 255) << 8) | Math.round(p.color.b * 255);
  s.blendMode = "add";
  s.eventMode = "none";
  layer.addChild(s);
  return [s, p.alpha];
}

function lightsOf(lights: { neon: Pool[]; daylight: Pool[] }, layer: Container) {
  return { neon: lights.neon.map((p) => poolSprite(p, layer)), daylight: lights.daylight.map((p) => poolSprite(p, layer)) };
}

/** ScreenGrade's vignette, baked once into a small texture and stretched over the frame. */
function vignetteTexture(): Texture {
  const w = 160;
  const h = 90;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // base colour (0.02, 0.02, 0.035)
      img.data[i] = 5;
      img.data[i + 1] = 5;
      img.data[i + 2] = 9;
      img.data[i + 3] = Math.round(Math.min(0.88, vignetteAlpha((x + 0.5) / w, (y + 0.5) / h)) * 255);
    }
  g.putImageData(img, 0, 0);
  return Texture.from(c);
}

/** ScreenGrade's grain: grey blocks, tiled and shifted a few times a second. */
function grainTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(Math.random() * 0.3 * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return Texture.from(c);
}

const WALL_HEIGHT = 172;

/**
 * GlassPartition._draw for a horizontal pane: the almost invisible veil, two
 * diagonal glints and the thin rail at the foot, over the pane's art.
 */
function glassSheen(footprint: Rect, zIndex: number): Graphics {
  const w = footprint.w;
  const g = new Graphics();
  g.position.set(footprint.x + w / 2, footprint.y + footprint.h / 2);
  g.rect(-w * 0.493, -WALL_HEIGHT * 0.94, w * 0.986, WALL_HEIGHT * 0.88).fill({ color: 0x94c7eb, alpha: 0.032 });
  for (const k of [-0.34, 0.18]) {
    const ax = w * k;
    const ay = -WALL_HEIGHT * 0.82;
    g.moveTo(ax, ay).lineTo(ax + 26, ay + 42);
  }
  g.stroke({ color: 0xeafaff, alpha: 0.12, width: 1.2 });
  g.moveTo(-w * 0.49, -2).lineTo(w * 0.49, -2).stroke({ color: 0x66b3e0, alpha: 0.18, width: 1.3 });
  g.zIndex = zIndex;
  g.eventMode = "none";
  return g;
}

/** SpriteSheetRig._draw: three soft ovals under the feet, and a cyan ring while walking. */
function agentShadow(): Graphics {
  const g = new Graphics();
  g.eventMode = "none";
  return g;
}

function placeShadow(g: Graphics, pose: AgentPose) {
  // Seated, the painted chair already stands on the floor: no second footprint.
  g.visible = pose.mode !== "sit" && !pose.seatedAt;
  if (!g.visible) return;
  const moving = pose.mode === "walk" || pose.mode === "carry";
  const key = moving ? "ring" : "plain";
  if (g.label !== key) {
    g.clear();
    for (let i = 0; i < 3; i++) g.ellipse(0, 0, (60 + i * 16) * RIG_SCALE, (60 + i * 16) * RIG_SCALE * 0.38).fill({ color: 0x000000, alpha: 0.16 - i * 0.045 });
    if (moving) g.ellipse(0, 0, 66 * RIG_SCALE, 66 * RIG_SCALE * 0.38).stroke({ color: 0xa6f2ff, alpha: 0.38, width: 3 * RIG_SCALE });
    g.label = key;
  }
  g.position.set(pose.pos.x, pose.pos.y);
}

// ─── Departments and piles ──────────────────────────────────────────────

const FONT = "JetBrains Mono, monospace";
const GREEN = 0x00e87a;

const colorOf = (hex: string) => parseInt(hex.replace("#", ""), 16);

/** A small deterministic random from a string (the blotches stay put between runs). */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 2 ** 32;
  };
}

/** DepartmentDressing._draw_zone: three faint tints, painted blotches, L brackets, name and tagline. */
function departmentDressing(dept: Department): Container {
  const c = new Container();
  c.eventMode = "none";
  const col = colorOf(dept.color);
  const z = dept.zone;
  const g = new Graphics();
  for (let i = 0; i < 3; i++) g.rect(z.x + 8 * i, z.y + 8 * i, z.w - 16 * i, z.h - 16 * i).fill({ color: col, alpha: 0.03 });
  const rnd = seededRandom(dept.id);
  const range = (a: number, b: number) => a + (b - a) * rnd();
  for (let i = 0; i < 14; i++) {
    const x = range(z.x + 24, z.x + z.w - 24);
    const y = range(z.y + 24, z.y + z.h - 24);
    const angle = range(0, Math.PI * 2);
    const squash = range(0.3, 0.6);
    const dark = rnd() < 0.5;
    const alpha = dark ? range(0.03, 0.07) : range(0.02, 0.05);
    const r = range(18, 64);
    const blot = new Graphics().ellipse(0, 0, r, r * squash).fill({ color: dark ? 0x000000 : col, alpha });
    blot.position.set(x, y);
    blot.rotation = angle;
    c.addChild(blot);
  }
  const L = 46;
  for (const [ox, oy, dx, dy] of [
    [z.x, z.y, 1, 1],
    [z.x + z.w, z.y, -1, 1],
    [z.x, z.y + z.h, 1, -1],
    [z.x + z.w, z.y + z.h, -1, -1],
  ]) {
    g.moveTo(ox, oy).lineTo(ox + dx * L, oy);
    g.moveTo(ox, oy).lineTo(ox, oy + dy * L);
  }
  g.stroke({ color: col, alpha: 0.42, width: 3 });
  c.addChildAt(g, 0);
  const at = dept.labelPos ?? { x: z.x + 18, y: z.y + z.h - 34 };
  const name = dept.name.toUpperCase();
  // draw_string's position is the baseline: the text's top is about a font size above
  const shadow = new Text({ text: name, style: { fontFamily: FONT, fontSize: 26, fontWeight: "800", fill: 0x000000 } });
  shadow.alpha = 0.55;
  shadow.position.set(at.x + 1, at.y - 26 + 1 + 4);
  const title = new Text({ text: name, style: { fontFamily: FONT, fontSize: 26, fontWeight: "800", fill: col } });
  title.alpha = 0.9;
  title.position.set(at.x, at.y - 26 + 4);
  c.addChild(shadow, title);
  if (dept.tagline) {
    const tag = new Text({ text: dept.tagline, style: { fontFamily: FONT, fontSize: 15, fontWeight: "500", fill: 0x7d8590 } });
    tag.alpha = 0.85;
    tag.position.set(at.x, at.y + 24 - 15 + 3);
    c.addChild(tag);
  }
  return c;
}

/** HandoffStation's tag: "RESEARCH  →  ANALYSIS" in a dark box with the department's border. */
function handoffTag(label: string, at: Vec, color: string, zIndex: number): Container {
  const c = new Container();
  c.eventMode = "none";
  const col = colorOf(color);
  const text = new Text({ text: label, style: { fontFamily: FONT, fontSize: 10, fontWeight: "700", fill: col } });
  const w = text.width;
  const box = new Graphics()
    .rect(-w / 2 - 5, -8, w + 10, 16)
    .fill({ color: 0x0a0a0f, alpha: 0.94 })
    .rect(-w / 2 - 5, -8, w + 10, 16)
    .stroke({ color: col, alpha: 0.9, width: 1.2 });
  text.position.set(-w / 2, -text.height / 2);
  c.addChild(box, text);
  c.position.set(at.x, at.y);
  c.zIndex = zIndex;
  return c;
}

/** The pile as paper: one sprite per sheet, and the count in a green-bordered box above the tallest stack. */
function paperPile(pile: Container, rule: PaperRule, sheet: Texture): (n: number | null) => void {
  const sheets = new Container();
  const badge = new Container();
  const hit = new Graphics();
  pile.addChild(hit, sheets, badge);
  let shown: number | null | undefined;
  const scale = rule.width / sheet.width;
  return (n) => {
    if (n === shown) return;
    shown = n;
    const count = Math.max(0, Math.min(n ?? 0, 2000));
    sheets.removeChildren().forEach((s) => s.destroy());
    for (const p of sheetPlacements(count, rule)) {
      const s = new Sprite(sheet);
      s.anchor.set(0.5);
      s.scale.set(scale);
      s.position.set(p.x, p.y);
      s.rotation = p.rotation;
      sheets.addChild(s);
    }
    const tower = towerHeight(count, rule);
    hit.clear().rect(-105, -44 - tower, 210, 92 + tower).fill({ color: 0x000000, alpha: 0.001 });
    badge.removeChildren().forEach((b) => b.destroy());
    if (n == null || n <= 0) return;
    const text = new Text({ text: String(n), style: { fontFamily: FONT, fontSize: 13, fontWeight: "700", fill: GREEN } });
    const x = 92;
    const y = -tower - 28;
    badge.addChild(
      new Graphics()
        .rect(x - 5, y - 14, text.width + 10, text.height + 7)
        .fill({ color: 0x0a0a0f, alpha: 0.94 })
        .rect(x - 5, y - 14, text.width + 10, text.height + 7)
        .stroke({ color: GREEN, width: 1.2 }),
    );
    text.position.set(x, y - 12);
    badge.addChild(text);
  };
}

/** Without paper art: the department-coloured counter. */
function counterBadge(pile: Container, color: string): (n: number | null) => void {
  pile.addChild(new Graphics().roundRect(-22, -30, 44, 30, 4).fill({ color: colorOf(color), alpha: 0.85 }));
  const label = new Text({ text: "—", style: { fontFamily: FONT, fontSize: 16, fontWeight: "700", fill: 0x0b0f14 } });
  label.anchor.set(0.5, 0.5);
  label.position.set(0, -15);
  pile.addChild(label);
  return (n) => {
    label.text = n == null ? "—" : String(n);
  };
}

// ─── The machines: box edges, hologram, printer, door, desk fronts ─────

function tesseractEdges(floor: Rect): Graphics {
  const g = new Graphics();
  for (const seg of tesseractRays(floor)) {
    g.moveTo(seg.from.x, seg.from.y).lineTo(seg.to.x, seg.to.y).stroke({ color: seg.color, alpha: seg.alpha * 0.35, width: 16, cap: "round" });
    g.moveTo(seg.from.x, seg.from.y).lineTo(seg.to.x, seg.to.y).stroke({ color: seg.color, alpha: seg.alpha, width: 4.5, cap: "round" });
  }
  for (const [x, y] of [
    [floor.x, floor.y],
    [floor.x + floor.w, floor.y],
    [floor.x + floor.w, floor.y + floor.h],
    [floor.x, floor.y + floor.h],
  ]) {
    g.circle(x, y, 22).fill({ color: 0x4d9eff, alpha: 0.3 * 0.25 });
    g.circle(x, y, 10).fill({ color: 0x73d9ff, alpha: 0.3 * 0.8 });
  }
  g.blendMode = "add";
  g.eventMode = "none";
  return g;
}

function drawHologram(g: Graphics, rect: Rect, t: number) {
  const { centre, radius } = hologramGlobe(rect);
  const { squash, pulse } = hologramFrame(t);
  g.clear();
  for (const k of squash) g.ellipse(centre.x, centre.y, radius * k, radius).stroke({ color: GREEN, alpha: 0.2 + 0.18 * pulse, width: 1.2 });
  g.circle(centre.x, centre.y, radius * 0.08).fill({ color: 0x7fffb2, alpha: 0.35 + 0.3 * pulse });
}

/** `t` null = idle: nothing drawn (the painted printer stays as it is). */
function drawPrinter(g: Graphics, s: number, t: number | null) {
  g.clear();
  if (t == null) return;
  const { ledOn, sheet } = printerFrame(t);
  g.circle(43 * s, -126 * s, 3.2 * s).fill({ color: 0x26f28c, alpha: ledOn ? 1 : 0.25 });
  const h = 24 * s * sheet;
  if (h > 0) g.rect(-28 * s, -111 * s, 54 * s, h).fill(0xf7f5eb).stroke({ color: 0x8c8c99, alpha: 0.8, width: 1 });
}

function exitDoor(at: Vec): { node: Container; step: (someone: boolean, dt: number) => void } {
  const node = new Container();
  node.position.set(at.x, at.y);
  node.zIndex = at.y;
  node.eventMode = "none";
  const fixed = new Graphics();
  fixed.rect(-75, -26, 150, 26).fill({ color: 0xffffff, alpha: 0.045 });
  for (const sx of [-1, 1]) fixed.rect(sx * 75 - 5, -64, 10, 70).fill(0x1f3d4a).stroke({ color: 0x73f2ff, alpha: 0.85, width: 1.5 });
  fixed.rect(-30, -92, 60, 22).fill(0x10151c).stroke({ color: GREEN, alpha: 0.8, width: 1.2 });
  const sign = new Text({ text: "EXIT", style: { fontFamily: FONT, fontSize: 13, fontWeight: "700", fill: GREEN } });
  sign.anchor.set(0.5);
  sign.position.set(0, -81);
  const leaves = new Graphics();
  node.addChild(fixed, leaves, sign);
  let open = 0;
  let hold = 0;
  let drawn = -1;
  const draw = () => {
    leaves.clear();
    for (const r of doorLeaves(open)) leaves.rect(r.x, r.y, r.w, r.h).fill({ color: 0x59d9ff, alpha: 0.3 }).stroke({ color: 0x73f2ff, alpha: 0.85, width: 1.2 });
    drawn = open;
  };
  draw();
  return {
    node,
    step(someone, dt) {
      // held open 1.6 s after the last passer, as ExitDoor.swing()
      hold = someone ? 1.6 : Math.max(0, hold - dt);
      open = doorStep(open, hold > 0, dt);
      if (open !== drawn) draw();
    },
  };
}

/** The part of a desk's picture below `cut` of its height, drawn again over the seated agent. */
function frontOccluder(where: Rect, tex: Texture, cut: number, flip: boolean): Sprite {
  const f = tex.frame;
  const part = new Texture({ source: tex.source, frame: new Rectangle(f.x, f.y + f.height * cut, f.width, f.height * (1 - cut)) });
  const s = placed(new Sprite(part), { x: where.x, y: where.y + where.h * cut, w: where.w, h: where.h * (1 - cut) }, flip);
  s.visible = false;
  s.eventMode = "none";
  return s;
}

/** AgentStateTag._draw: a dark plate with the status colour's border, the (unlit) LED and the label. */
function stateTag(label: string, color: number): Container {
  const c = new Container();
  c.eventMode = "none";
  const text = new Text({ text: label, style: { fontFamily: FONT, fontSize: 11, fontWeight: "700", fill: 0xf0f0fa } });
  const w = text.width + 24;
  const h = 24;
  const g = new Graphics()
    .rect(-w / 2, -h / 2, w, h)
    .fill({ color: 0x16161d, alpha: 0.96 })
    .rect(-w / 2, -h / 2, w, h)
    .stroke({ color, alpha: 0.85, width: 1.4 });
  // the game lights this LED from the CPU sampler, which the cloud does not have: always unlit
  g.circle(-w / 2 + 9, 0, 3).fill(0x252530);
  g.circle(-w / 2 + 9, 0, 2.7).stroke({ color: 0x4a4a5e, alpha: 0.8, width: 0.8 });
  text.position.set(-w / 2 + 16, -text.height / 2);
  c.addChild(g, text);
  return c;
}
