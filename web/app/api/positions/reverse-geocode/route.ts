import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Reverse geocoding proxy verso Nominatim (free OSM, 1 req/s policy).
// Cache in-memory keyed su lat/lon arrotondati (~10m precision) →
// click multipli sullo stesso pin = 1 sola chiamata. Server-side perché
// browser non può settare User-Agent richiesto da Nominatim.
//
// Quando l'office geocoding (Scout/Analista skill) popolerà
// `positions.office_address` con indirizzi precisi via forward
// geocoding (company+JD), questa fallback diventerà inutile per
// quelle posizioni.

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "JobHunterTeam/0.1 (lazy-reverse-geocode)";

// Cache process-locale: TTL di fatto = lifecycle del server Next dev.
// In prod (Vercel serverless) la cache è per-instance, va bene.
const cache = new Map<string, { address: string | null; at: number }>();
const TTL_MS = 24 * 60 * 60 * 1000; // 1 giorno

function key(lat: number, lon: number) {
  return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
  }
  const k = key(lat, lon);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ address: hit.address, cached: true });
  }

  try {
    const u = new URL(NOMINATIM);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lon));
    u.searchParams.set("format", "json");
    u.searchParams.set("zoom", "18");
    u.searchParams.set("addressdetails", "1");
    const res = await fetch(u.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { address: null, error: `nominatim ${res.status}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    // Preferenza: "road + house_number, suburb, city". Fallback a
    // display_name (più verboso, include country).
    const a = data.address ?? {};
    const street = [a.road, a.house_number].filter(Boolean).join(" ").trim();
    const cityLine = [a.suburb, a.city || a.town || a.village]
      .filter(Boolean)
      .join(", ");
    const composed = [street, cityLine]
      .filter((s) => s && s.length > 0)
      .join(", ");
    const address = composed || data.display_name || null;

    cache.set(k, { address, at: Date.now() });
    return NextResponse.json({ address, cached: false });
  } catch (e) {
    return NextResponse.json(
      { address: null, error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
