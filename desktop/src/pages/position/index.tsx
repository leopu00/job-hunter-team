import PositionLoading from "@/app/(protected)/positions/[id]/loading";
import WebPositionPage from "@/app/(protected)/positions/[id]/page";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";

/**
 * The web's /positions/:id (web/app/(protected)/positions/[id]/page.tsx), run
 * as it is, with the user's data read through the server stand-ins
 * (src/web-shims/server). Its buttons call the web's /api routes, which the
 * shell's bridge answers.
 */
export default function PositionPage({ params }: PageProps) {
  const id = params.id ?? "";
  return (
    <ServerPage
      key={id}
      render={() => WebPositionPage({ params: Promise.resolve({ id }) })}
      fallback={<PositionLoading />}
    />
  );
}
