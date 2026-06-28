<!-- @translation: hu, ai-translated 2026-06-06 -->
# 🪟 Tmux munkamenetek

A JHT csapat tmux munkamenetek egyuttesekent fut a konteneren belul. A munkamenet-nevek **nagybetusek, emoji nelkul, szokozok nelkul**.

## 📛 Elnevezesi konvencio

| Pattern | Jelentes | Peldak |
|---|---|---|
| `<ROLE>` | Singleton — csak egy peldany | `CAPITANO` · `CRITICO` · `SENTINELLA` · `ASSISTENTE` |
| `<ROLE>-<N>` | Pool-tag — N pozitiv egesz szam | `SCOUT-1` · `ANALISTA-2` · `SCRITTORE-3` |
| `<ROLE>-S<N>` | Masik agens altal dinamikusan letrehozott | `CRITICO-S1` (`SCRITTORE-1` hozta letre), `CRITICO-S2`, … |

## 📚 Ismert munkamenetek

### Pool munkamenetek (a Kapitany donti el a peldanyszamot)

| Munkamenet-prefix | Szerep | Megjegyzesek |
|---|---|---|
| `SCOUT-<N>` | Felterkepezs | Tobb peldany, peer-koordinacio a `scout_coord.py` segitsegevel |
| `ANALISTA-<N>` | Ellenorzes | A `next-for-analista` sorbol dolgozik |
| `SCORER-<N>` | Pontozas | A `next-for-scorer` sorbol dolgozik |
| `SCRITTORE-<N>` | Iras | A `next-for-scrittore` sorbol dolgozik (score DESC) |

### Singletonok

| Munkamenet | Szerep | Megjegyzesek |
|---|---|---|
| `CAPITANO` | Csapatparancsnok | Egyetlen peldany — koordinalja a parancsokat, az allapotot, az eszkalaciot |
| `CRITICO` | Onallo Kritikus | Legacy — V5-ben a Kritikust az Irok dinamikusan hozzak letre (lasd alabb) |
| `SENTINELLA` | Fogyasztas-watchdog | Edge-triggered, csak a `CAPITANO`-val kommunikal |
| `ASSISTENTE` | Felhasznalo oldali copilot | A felhasznaloi kereseket parancsokka forditja |
| `MENTOR` | Career-coach agens | Aktiv — felhasznalo-orientalt, mindig aktiv, bootolaskor jon letre |

### Dinamikus munkamenetek

| Munkamenet | Letrehozta | Elettartam |
|---|---|---|
| `CRITICO-S<N>` | `SCRITTORE-<N>` (minden felulvizsgalati korhoz egy uj Kritikus) | Egy felulvizsgalati keres → egy munkamenet, az Iro azonnal utana megszunteti |
| `DOTTORE` | watchdog (napi idoeres) | Egyszer futo — agens-allapot ellenoerzes, jelent a `CAPITANO`-nak, majd oenmegsemmisul |
| `MANTENITORE` | watchdog (napi idoeres) | Egyszer futo — infra-allapot ellenoerzes, jelent a `CAPITANO`-nak, majd oenmegsemmisul |

Az Iro letrehozza a `CRITICO-S<N>` munkamenetet a sajat szamanak megfeleloen (`SCRITTORE-1` → `CRITICO-S1`), vegrehajtja a felulvizsgalatot, majd `tmux kill-session`. Minden egyes felulvizsgalati korhoz — a 3-bol **mindegyikhez** — uj Kritikus-peldany jon letre, soha nem kerul ujrafelhasznalasra.

## 🔗 Kapcsolodo

- 💬 [`communication-rules.md`](communication-rules.md) — uzenetborítek, `jht-tmux-send`, ki mit kuld
- 🛡️ [`anti-collision.md`](anti-collision.md) — peer-koordinacio a pool tagok kozott
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — teljes csapat-osszetitel es szintbesorolas
