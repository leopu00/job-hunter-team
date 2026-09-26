import WebMessagesPage from "@/app/(protected)/messages/page";
import DashboardSkeleton from "@/app/(protected)/_components/DashboardSkeleton";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";

/**
 * web/app/(protected)/messages, run as it is: the chat with the team (history,
 * replies, new turns, Realtime).
 */
export default function MessagesPage(_props: PageProps) {
  return <ServerPage render={() => WebMessagesPage()} fallback={<DashboardSkeleton label="Caricamento messaggi" />} />;
}
