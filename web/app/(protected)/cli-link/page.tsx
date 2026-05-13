import CliLinkClient from "./CliLinkClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Connetti CLI · Job Hunter Team",
  description: "Conferma il pairing del tuo VPS o PC con questo account.",
};

export default function CliLinkCompany() {
  return <CliLinkClient />;
}
