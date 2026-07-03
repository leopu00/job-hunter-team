import { redirect } from "next/navigation";

// The desktop app is NOT publicly promoted yet: it works end-to-end but still
// has gaps we haven't finished testing (see desktop/STATUS.md). Until it's
// ready, we don't hand out installers from the web — the supported path is the
// CLI. So /download bounces to the CLI guide instead of serving .exe/.dmg/
// .AppImage builds.
//
// The full installer-picker UI still lives in git history (and DownloadClient
// stays on disk, dormant): to re-open desktop downloads, restore the previous
// version of this file — no other change needed.
export default function DownloadPage() {
  redirect("/docs/guides/cli");
}
