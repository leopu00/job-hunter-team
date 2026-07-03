import DownloadClient from "./DownloadClient";

// 2026-07-03: l'app desktop non è ancora scaricabile dal web (non ancora promossa —
// vedi docs/internal/2026-07-03-desktop-app-status-and-vision.md). La pagina non
// deve più interrogare le GitHub Releases né fare UA-detection per servire gli
// installer: mostra il percorso CLI (terminale) e un tab Desktop "in arrivo",
// quindi è una pagina statica senza dati di release.
export default function DownloadPage() {
  return <DownloadClient />;
}
