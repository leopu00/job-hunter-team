import DownloadClient from "./DownloadClient";
import { attributionFromPage } from "@/lib/download-funnel";

// La pagina non interroga le GitHub Releases e non usa UA-detection. Riceve
// solo i tre parametri campagna correnti, li sanifica sul server e li passa ai
// link `/go/*`; ogni altro parametro viene scartato.
type DownloadPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DownloadPage({
  searchParams,
}: DownloadPageProps) {
  const attribution = attributionFromPage(await searchParams);
  return <DownloadClient attribution={attribution} />;
}
