# PIANO — JHT Panel (archiviato)

**Data originale:** 2026-03-15
**Stato:** ⚠️ Superato dalla nuova direzione prodotto

---

## 📌 Nota

Questo documento descriveva un piano per una **app desktop nativa Rust + egui** che parlasse direttamente con `tmux`.

La direzione attuale del progetto e' diversa:

- 🧭 l'app desktop diventa un **launcher/orchestratore**
- 🌐 la GUI principale resta la **dashboard web** esistente
- 🚀 il launcher installa e avvia JHT in background
- 🔗 quando il runtime locale e' pronto, apre il browser su `http://localhost:3000`

---

## ✅ Nuova direzione

Il piano attivo e' ora quello descritto in:

- [`README.md`](../README.md)
- [`BACKLOG.md`](../BACKLOG.md)
- [`docs/ROADMAP.md`](./ROADMAP.md)

In sintesi:

- 📦 installer desktop (`.dmg`, `.exe`, `.AppImage`, `.deb`)
- 🛠️ bootstrap silenzioso del runtime locale
- 🧠 provider AI a scelta; `Claude CLI` solo se serve davvero
- 🌍 nessun terminale per l'utente finale
- 🖥️ esperienza principale nel browser locale, non in una UI desktop riscritta

---

## 🗃️ Perche' viene archiviato

- Evita di duplicare la UI gia' esistente in `web/`
- Riduce drasticamente il codice da mantenere
- Permette di arrivare prima a pacchetti desktop realmente utili (`.dmg`, `.exe`, `.AppImage`, `.deb`)
- Mantiene la web dashboard come single source of truth della UX
