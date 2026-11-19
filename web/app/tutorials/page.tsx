import { permanentRedirect } from "next/navigation";

export default function TutorialsPage() {
  permanentRedirect("/docs/guides/getting-started");
}
