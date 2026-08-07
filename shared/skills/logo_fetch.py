"""Company logo fetch (logo-extraction skill, mig 056).

Scarica il logo di un'azienda dal suo sito web (o da un URL esplicito),
lo valida (formato, peso, dimensioni minime) e lo salva in
`companies.logo` come data-URI base64 + `logo_source` + `logo_fetched=1`.

Perché data-URI in colonna e non file/storage: i loghi sono hard-capped a
~35KB raw, viaggiano con la sync companies esistente (push route + questo
repo `db_to_supabase.py`) e la CSP del web permette già `data:` in img-src
→ zero infrastruttura nuova. Vedi `_db.py::_migrate_companies_logo` +
Supabase mig 056.

Strategia sorgenti (in ordine di qualità attesa, senza Pillow nel
container → niente resize: si SELEZIONA una sorgente già piccola):
  1. <link rel="apple-touch-icon"> (tipicamente 180x180 PNG: il punto
     dolce qualità/peso)
  2. <link rel="icon"> / "shortcut icon" con sizes dichiarate grandi
  3. <meta property="og:image"> (spesso troppo grande → passa il cap solo
     se leggero)
  4. path convenzionali: /apple-touch-icon.png, /favicon-192x192.png,
     /favicon.png, /favicon.ico

Validazione: magic bytes (PNG/JPEG/WebP/ICO — SVG rifiutato di proposito),
peso 200B..35KB, lato minimo >= 32px quando leggibile dall'header
(PNG/ICO/WebP; JPEG accettato senza check dimensioni). Niente fiducia nel
Content-Type del server.

Enrichment-policy (risparmio, `enrichment_policy.py`): il fetch autonomo
rispetta `$JHT_HOME/profile/enrichment-policy.json` A CODICE —
  - economy=true o logo.enabled=false → POLICY_DISABLED (nessun fetch,
    nessuna scrittura);
  - logo.min_score=N → POLICY_SCORE_GATE se l'azienda non ha alcuna
    posizione viva con best score >= N. NON marca logo_fetched: quando
    lo Scorer supera la soglia, l'azienda rientra in coda da sola.
`--force` scavalca la policy (intervento manuale esplicito).

Uso (Analista, skill `logo-extraction`):
  python3 logo_fetch.py "Wizz Air"                     # website dalla riga companies
  python3 logo_fetch.py "Wizz Air" --website https://wizzair.com
  python3 logo_fetch.py "Wizz Air" --from-url https://.../logo.png
  python3 logo_fetch.py "Wizz Air" --mark-attempted    # nulla di usabile: flagga e basta
  python3 logo_fetch.py "Wizz Air" --dry-run           # valuta senza scrivere
  python3 logo_fetch.py "Wizz Air" --force             # rifetch/scavalca policy

Output (single JSON line su stdout, exit 0 ok / 1 failure):
  {"ok": true, "company": "Wizz Air", "source": "https://...",
   "mime": "image/png", "bytes": 8123, "width": 180, "height": 180,
   "written": true}
  {"ok": false, "error": "...", "status_code": "NOT_FOUND" | "NO_WEBSITE"
   | "NO_CANDIDATE" | "FETCH_ERROR" | "DB_ERROR"
   | "POLICY_DISABLED" | "POLICY_SCORE_GATE"}
"""

import argparse
import base64
import json
import re
import struct
import sys
from html import unescape
from urllib.parse import urljoin, urlparse

import requests

from _db import get_db, ensure_schema
from enrichment_policy import disabled_reason, is_enabled, logo_min_score

MAX_LOGO_BYTES = 35_000     # cap rigido: la riga companies resta piccola
MIN_LOGO_BYTES = 200        # sotto: pixel-tracker / favicon vuota
MIN_LOGO_DIM = 32           # px, lato minimo (16x16 = pixelato → scarta)
MAX_HTML_BYTES = 512_000    # cap lettura homepage
TIMEOUT = 15

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x00\x00\x01\x00", "image/x-icon"),
)


def sniff_mime(data: bytes) -> str | None:
    """Identifica il formato dai magic bytes (mai dal Content-Type)."""
    for magic, mime in MAGIC:
        if data.startswith(magic):
            return mime
    # WebP: RIFF....WEBP
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def image_dims(data: bytes, mime: str) -> tuple[int, int] | None:
    """Dimensioni dall'header, dove leggibili senza libreria immagini.

    PNG: IHDR width/height big-endian a offset 16. ICO: primo entry della
    directory (0 = 256). WebP: VP8X canvas / VP8L / VP8 lossy. JPEG: il
    parse SOF è fragile senza libreria → None (accettato senza check).
    """
    try:
        if mime == "image/png" and len(data) >= 24:
            w, h = struct.unpack(">II", data[16:24])
            return w, h
        if mime == "image/x-icon" and len(data) >= 8:
            w, h = data[6], data[7]
            return (w or 256), (h or 256)
        if mime == "image/webp" and len(data) >= 30:
            chunk = data[12:16]
            if chunk == b"VP8X":
                w = int.from_bytes(data[24:27], "little") + 1
                h = int.from_bytes(data[27:30], "little") + 1
                return w, h
            if chunk == b"VP8L":
                bits = int.from_bytes(data[21:25], "little")
                return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
            if chunk == b"VP8 ":
                w = int.from_bytes(data[26:28], "little") & 0x3FFF
                h = int.from_bytes(data[28:30], "little") & 0x3FFF
                return w, h
    except Exception:
        pass
    return None


def fetch_bytes(url: str, cap: int) -> bytes | None:
    """GET in streaming con cap: oltre `cap` byte interrompe e scarta."""
    try:
        r = requests.get(
            url,
            headers={"User-Agent": UA, "Accept": "image/*,*/*;q=0.8"},
            timeout=TIMEOUT,
            stream=True,
            allow_redirects=True,
        )
        if r.status_code != 200:
            return None
        buf = b""
        for chunk in r.iter_content(8192):
            buf += chunk
            if len(buf) > cap:
                return None
        return buf
    except requests.RequestException:
        return None


# (regex, priorità, size di default se non dichiarata)
# href/content estratti a parte; sizes="NxN" quando presente raffina l'ordine.
LINK_RE = re.compile(
    r"<(?:link|meta)\b[^>]*>", re.IGNORECASE
)
ATTR_RE = re.compile(
    r"""([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']"""
)


def collect_candidates(html: str, base_url: str) -> list[tuple[int, int, str]]:
    """Estrae (priorità, -size_hint, url) dai tag <link>/<meta> della home.

    Priorità: 1 apple-touch-icon, 2 icon con sizes >= 96, 3 og:image,
    4 icon qualunque. Ai path convenzionali (aggiunti dal chiamante) va 5.
    """
    out: list[tuple[int, int, str]] = []
    for tag in LINK_RE.findall(html):
        attrs = {k.lower(): unescape(v) for k, v in ATTR_RE.findall(tag)}
        rel = (attrs.get("rel") or "").lower()
        prop = (attrs.get("property") or attrs.get("name") or "").lower()
        href = attrs.get("href") or attrs.get("content") or ""
        if not href or href.startswith("data:"):
            continue
        # size hint: sizes="180x180" (primo numero) o 0
        m = re.match(r"(\d+)", (attrs.get("sizes") or ""))
        size_hint = int(m.group(1)) if m else 0
        url = urljoin(base_url, href.strip())
        if "apple-touch-icon" in rel:
            out.append((1, -(size_hint or 180), url))
        elif "icon" in rel:
            prio = 2 if size_hint >= 96 else 4
            out.append((prio, -size_hint, url))
        elif prop == "og:image":
            out.append((3, 0, url))
    return out


def pick_logo(website: str) -> tuple[bytes, str, str] | None:
    """Prova i candidati in ordine; ritorna (bytes, mime, source_url)."""
    if not re.match(r"^https?://", website, re.IGNORECASE):
        website = "https://" + website.lstrip("/")
    html = ""
    try:
        r = requests.get(
            website,
            headers={"User-Agent": UA},
            timeout=TIMEOUT,
            stream=True,
            allow_redirects=True,
        )
        if r.status_code == 200:
            buf = b""
            for chunk in r.iter_content(8192):
                buf += chunk
                if len(buf) > MAX_HTML_BYTES:
                    break
            html = buf.decode(r.encoding or "utf-8", errors="replace")
            website = str(r.url)  # base post-redirect per gli href relativi
    except requests.RequestException:
        pass  # niente home raggiungibile → restano i path convenzionali

    candidates = collect_candidates(html, website) if html else []
    for path in (
        "/apple-touch-icon.png",
        "/favicon-192x192.png",
        "/favicon.png",
        "/favicon.ico",
    ):
        candidates.append((5, 0, urljoin(website, path)))

    seen: set[str] = set()
    for _, _, url in sorted(candidates):
        if url in seen:
            continue
        seen.add(url)
        data = validate_image(fetch_bytes(url, MAX_LOGO_BYTES))
        if data:
            return data[0], data[1], url
    return None


def validate_image(raw: bytes | None) -> tuple[bytes, str] | None:
    """Magic bytes + peso + lato minimo. None = scarta il candidato."""
    if raw is None or not (MIN_LOGO_BYTES <= len(raw) <= MAX_LOGO_BYTES):
        return None
    mime = sniff_mime(raw)
    if mime is None:
        return None
    dims = image_dims(raw, mime)
    if dims is not None and min(dims) < MIN_LOGO_DIM:
        return None
    return raw, mime


def run(args: argparse.Namespace) -> dict:
    conn = get_db()
    ensure_schema(conn)

    row = conn.execute(
        "SELECT id, name, website, logo, logo_fetched FROM companies "
        "WHERE name = ? COLLATE NOCASE",
        (args.company,),
    ).fetchone()
    if not row:
        return {
            "ok": False,
            "error": f"Company {args.company!r} is not in companies "
                     "(first run: db_insert.py company --name ...)",
            "status_code": "NOT_FOUND",
        }

    if row["logo"] and not args.force:
        return {
            "ok": True,
            "company": row["name"],
            "written": False,
            "note": "logo already present (use --force to fetch it again)",
        }

    # Enrichment-policy (risparmio): enforcement A CODICE, prima di ogni
    # fetch. --force scavalca (intervento manuale esplicito, non autonomo).
    if not args.force:
        if not is_enabled("logo"):
            return {
                "ok": False,
                "error": f"Logo fetch blocked: {disabled_reason('logo')}",
                "status_code": "POLICY_DISABLED",
            }
        ms = logo_min_score()
        if ms is not None:
            best = conn.execute(
                """
                SELECT MAX(s.total_score) FROM positions p
                JOIN scores s ON s.position_id = p.id
                WHERE p.company_id = ? AND p.status != 'excluded'
                """,
                (row["id"],),
            ).fetchone()[0]
            if best is None or best < ms:
                # NIENTE logo_fetched=1: quando lo Scorer supererà la
                # soglia, l'azienda rientra nella coda logo-missing.
                return {
                    "ok": False,
                    "error": (f"Below policy threshold (logo.min_score={ms}, "
                              f"best company score={best}): do not fetch now"),
                    "status_code": "POLICY_SCORE_GATE",
                }

    picked: tuple[bytes, str, str] | None = None
    if args.from_url:
        raw = validate_image(fetch_bytes(args.from_url, MAX_LOGO_BYTES))
        if raw:
            picked = (raw[0], raw[1], args.from_url)
    else:
        website = args.website or row["website"]
        if not website:
            return {
                "ok": False,
                "error": "No known website for the company: pass --website "
                         "or --from-url, or update companies",
                "status_code": "NO_WEBSITE",
            }
        picked = pick_logo(website)

    if picked is None:
        if args.mark_attempted and not args.dry_run:
            conn.execute(
                "UPDATE companies SET logo_fetched = 1 WHERE id = ?",
                (row["id"],),
            )
            conn.commit()
        return {
            "ok": False,
            "error": "No valid candidate (format, size, or dimensions)",
            "status_code": "NO_CANDIDATE",
            "marked_attempted": bool(args.mark_attempted and not args.dry_run),
        }

    raw, mime, source = picked
    data_uri = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
    dims = image_dims(raw, mime)
    if not args.dry_run:
        conn.execute(
            "UPDATE companies SET logo = ?, logo_source = ?, "
            "logo_fetched = 1 WHERE id = ?",
            (data_uri, source, row["id"]),
        )
        conn.commit()
    return {
        "ok": True,
        "company": row["name"],
        "source": source,
        "mime": mime,
        "bytes": len(raw),
        "width": dims[0] if dims else None,
        "height": dims[1] if dims else None,
        "written": not args.dry_run,
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Fetch, validate, and save a company logo (mig 056)"
    )
    p.add_argument("company", help="EXACT name from the companies row")
    p.add_argument("--website", help="Website override (default: website column)")
    p.add_argument("--from-url", help="Direct image URL (skips discovery)")
    p.add_argument("--force", action="store_true",
                   help="Fetch again even when present; bypass the enrichment "
                        "policy as an explicit manual action")
    p.add_argument("--mark-attempted", action="store_true",
                   help="On failure, set logo_fetched=1 to leave the queue")
    p.add_argument("--dry-run", action="store_true",
                   help="Evaluate and report without writing to the database")
    args = p.parse_args()

    try:
        result = run(args)
    except Exception as e:  # DB o inatteso: mai stack-trace sull'agente
        result = {"ok": False, "error": str(e), "status_code": "DB_ERROR"}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
