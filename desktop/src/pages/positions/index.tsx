import PositionsLoading from "@/app/(protected)/positions/loading";
import WebPositionsPage from "@/app/(protected)/positions/page";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";
import { usePositionArchive } from "../../lib/use-position-archive";
import { PageDataNotice } from "../../lib/PageDataNotice";

/**
 * The web's /positions (web/app/(protected)/positions/page.tsx), run as it
 * is: list, sidebar filters, search, sort, columns and paging, with the
 * user's data read through the server stand-ins (src/web-shims/server). The
 * filters live in the query string, as on the web, so the page reads again
 * when it changes, keeping the list and the sidebar on screen meanwhile.
 */
export default function PositionsPage({ search }: PageProps) {
  const searchParams = Object.fromEntries(search);
  const archive = usePositionArchive(search.toString());
  return (
    <>
    <PageDataNotice at={archive.at} error={archive.error} />
    <ServerPage
      runKey={`${search.toString()}|${archive.version}`}
      dataSource={archive.source}
      scopeKey={archive.scope}
      canCommit={archive.current}
      render={() => WebPositionsPage({ searchParams: Promise.resolve(searchParams) })}
      fallback={<PositionsLoading />}
    />
    </>
  );
}
