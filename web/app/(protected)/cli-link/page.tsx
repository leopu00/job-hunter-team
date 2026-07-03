import type { Metadata } from "next";
import { getRequestLocale } from "@/lib/request-locale";
import CliLinkClient from "./CliLinkClient";

export const dynamic = "force-dynamic";

// NB: questa pagina è servita anche sul cloud (flusso di pairing dal browser),
// dove ~/.jht non esiste: la locale va letta dal cookie della request
// (getRequestLocale), come fa già il layout dell'area protetta — non da
// getServerLocale.
const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Connetti CLI · Job Hunter Team",
    description: "Conferma il pairing del tuo VPS o PC con questo account.",
  },
  en: {
    title: "Connect CLI · Job Hunter Team",
    description: "Confirm the pairing of your VPS or PC with this account.",
  },
  es: {
    title: "Conectar CLI · Job Hunter Team",
    description: "Confirma el emparejamiento de tu VPS o PC con esta cuenta.",
  },
  fr: {
    title: "Connecter la CLI · Job Hunter Team",
    description: "Confirmez l'appairage de votre VPS ou PC avec ce compte.",
  },
  de: {
    title: "CLI verbinden · Job Hunter Team",
    description: "Bestätige die Kopplung deines VPS oder PCs mit diesem Konto.",
  },
  hu: {
    title: "CLI csatlakoztatása · Job Hunter Team",
    description: "Erősítsd meg a VPS-ed vagy PC-d párosítását ezzel a fiókkal.",
  },
  pt: {
    title: "Ligar CLI · Job Hunter Team",
    description: "Confirma o emparelhamento do teu VPS ou PC com esta conta.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getRequestLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function CliLinkPage() {
  return <CliLinkClient />;
}
