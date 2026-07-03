import DownloadClient from "./DownloadClient";

// 2026-07-03: l'app desktop non è più scaricabile dal web (non ancora promossa —
// vedi docs/internal/2026-07-03-desktop-app-status-and-vision.md). La pagina non
// deve più interrogare le GitHub Releases né fare UA-detection per servire gli
// installer: mostra solo i percorsi CLI (terminale) e prompt-assistente, quindi
// è una pagina statica senza dati di release.
export default function DownloadPage() {
  return <DownloadClient />;
}
