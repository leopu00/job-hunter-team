// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import { startAutopilot } from "../../../web/app/components/landing/LandingGlobe";
import { landingTour } from "../../../web/app/components/landing/LandingGlobe.data";

type CameraOptions = {
  center?: [number, number];
  zoom?: number;
  duration?: number;
};

/**
 * Camera MapLibre minima ma temporale: stop() congela davvero il punto
 * corrente e genera moveend, le animazioni concluse generano anche idle.
 * È sufficiente per esercitare la macchina a stati, non soltanto cercarla
 * come stringa nel sorgente.
 */
class FakeMap {
  center = { lng: 10, lat: 45 };
  zoom = 1.8;
  easeCalls: CameraOptions[] = [];
  flyCalls: CameraOptions[] = [];
  jumpCalls: CameraOptions[] = [];

  private listeners = new Map<string, Set<() => void>>();
  private animation:
    | {
        timer: number;
        startedAt: number;
        duration: number;
        from: { lng: number; lat: number; zoom: number };
        to: { lng: number; lat: number; zoom: number };
      }
    | undefined;

  loaded() {
    return true;
  }

  getCenter() {
    return { ...this.center };
  }

  getZoom() {
    return this.zoom;
  }

  on(event: string, callback: () => void) {
    const bucket = this.listeners.get(event) ?? new Set();
    bucket.add(callback);
    this.listeners.set(event, bucket);
    return this;
  }

  once(event: string, callback: () => void) {
    const once = () => {
      this.off(event, once);
      callback();
    };
    return this.on(event, once);
  }

  off(event: string, callback: () => void) {
    this.listeners.get(event)?.delete(callback);
    return this;
  }

  private emit(event: string) {
    for (const callback of [...(this.listeners.get(event) ?? [])]) callback();
  }

  private animate(options: CameraOptions) {
    this.stop();
    const duration = options.duration ?? 0;
    const from = { ...this.center, zoom: this.zoom };
    const to = {
      lng: options.center?.[0] ?? from.lng,
      lat: options.center?.[1] ?? from.lat,
      zoom: options.zoom ?? from.zoom,
    };
    const finish = () => {
      this.center = { lng: to.lng, lat: to.lat };
      this.zoom = to.zoom;
      this.animation = undefined;
      this.emit("moveend");
      this.emit("idle");
    };
    if (duration <= 0) {
      finish();
      return;
    }
    this.animation = {
      timer: window.setTimeout(finish, duration),
      startedAt: Date.now(),
      duration,
      from,
      to,
    };
  }

  easeTo(options: CameraOptions) {
    this.easeCalls.push(options);
    this.animate(options);
    return this;
  }

  flyTo(options: CameraOptions) {
    this.flyCalls.push(options);
    this.animate(options);
    return this;
  }

  jumpTo(options: CameraOptions) {
    this.stop();
    if (options.center) {
      this.center = { lng: options.center[0], lat: options.center[1] };
    }
    if (options.zoom != null) this.zoom = options.zoom;
    this.jumpCalls.push(options);
    this.emit("moveend");
    return this;
  }

  stop() {
    const animation = this.animation;
    if (!animation) return this;
    window.clearTimeout(animation.timer);
    const progress = Math.min(
      1,
      Math.max(0, (Date.now() - animation.startedAt) / animation.duration),
    );
    this.center = {
      lng:
        animation.from.lng +
        (animation.to.lng - animation.from.lng) * progress,
      lat:
        animation.from.lat +
        (animation.to.lat - animation.from.lat) * progress,
    };
    this.zoom =
      animation.from.zoom +
      (animation.to.zoom - animation.from.zoom) * progress;
    this.animation = undefined;
    this.emit("moveend");
    return this;
  }
}

const HOP_MS = 8500;
const CONTINENT_MS = 14000;
const FIRST_MS = 12000;
const CARD_MS = 2300;
const INTRO_MS = 5500;

function durationAt(
  tour: ReturnType<typeof landingTour>,
  stopSeq: number,
): number {
  if (stopSeq === 0) return FIRST_MS;
  const stop = tour[stopSeq % tour.length];
  const prev = tour[(stopSeq + tour.length - 1) % tour.length];
  return prev.continent !== stop.continent ? CONTINENT_MS : HOP_MS;
}

function setup() {
  const map = new FakeMap();
  const tour = landingTour("en");
  const cards: Array<string | null> = [];
  const handle = startAutopilot(map as unknown as MaplibreMap, tour, {
    onCardChange: (id) => cards.push(id),
    onBegan: () => {},
  });
  return { map, tour, cards, handle };
}

describe("autopilota temporale del globo landing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rientrando nella seconda metà del volo continua la discesa", () => {
    const { map, handle, tour } = setup();
    vi.advanceTimersByTime(INTRO_MS);
    expect(map.flyCalls).toHaveLength(1);

    vi.advanceTimersByTime(7000); // oltre metà del primo volo da 12 s
    handle.pause("offscreen");
    vi.advanceTimersByTime(10);
    handle.unpause("offscreen");

    // Nessun secondo flyTo: ricreerebbe uno zoom-out quando il volo era
    // già in discesa. Resta solo l'ease verso la stessa prima città.
    expect(map.flyCalls).toHaveLength(1);
    expect(map.easeCalls.at(-1)?.center).toEqual([tour[0].lon, tour[0].lat]);
    expect(map.easeCalls.at(-1)?.duration).toBe(4990);
    handle.dispose();
  });

  it("accumula due intervalli offscreen dentro la stessa pausa utente", () => {
    const { map, handle, tour, cards } = setup();
    handle.pause("user");
    handle.pause("offscreen");
    vi.advanceTimersByTime(6000);
    handle.unpause("offscreen"); // resta sospeso per la mano

    handle.pause("offscreen");
    vi.advanceTimersByTime(13000);
    handle.unpause("user"); // resta sospeso perché di nuovo offscreen
    handle.unpause("offscreen");

    const best = [...tour[0].positions].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    )[0];
    expect(cards.at(-1)).toBe(best.id);
    expect(map.flyCalls).toHaveLength(0);
    expect(map.jumpCalls.at(-1)?.center).toEqual([tour[0].lon, tour[0].lat]);
    handle.dispose();
  });

  it("salta più loop completi e ripristina la card del tempo corrente", () => {
    const { map, handle, tour, cards } = setup();
    handle.pause("offscreen");

    const firstLoopMs = tour.reduce(
      (total, stop, stopSeq) =>
        total + durationAt(tour, stopSeq) + stop.positions.length * CARD_MS,
      INTRO_MS,
    );
    const repeatedLoopMs = tour.reduce(
      (total, stop, stopIndex) =>
        total +
        durationAt(tour, tour.length + stopIndex) +
        stop.positions.length * CARD_MS,
      0,
    );
    const elapsed =
      firstLoopMs +
      repeatedLoopMs * 3 +
      durationAt(tour, tour.length * 4) +
      1000;
    vi.advanceTimersByTime(elapsed);
    handle.unpause("offscreen");

    const best = [...tour[0].positions].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    )[0];
    expect(cards.at(-1)).toBe(best.id);
    expect(map.jumpCalls.at(-1)?.center).toEqual([tour[0].lon, tour[0].lat]);
    handle.dispose();
  });
});
