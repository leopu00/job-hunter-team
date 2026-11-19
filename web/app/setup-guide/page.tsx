import { permanentRedirect } from "next/navigation";

// 0.4.0 is installed and set up from the terminal, and the desktop app this guide followed is not in it. The site's
// guide of the command-line path is Getting Started, in the seven languages: the old address leads there for good.
export default function SetupGuidePage() {
  permanentRedirect("/docs/guides/getting-started");
}
