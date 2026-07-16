import { getMessagesHistory } from "@/lib/queries";
import MessagesList from "@/app/components/MessagesList";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const messages = await getMessagesHistory(200);

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="max-w-4xl mx-auto px-5 pt-8 pb-16">
        <MessagesList initialMessages={messages} />
      </div>
    </div>
  );
}
