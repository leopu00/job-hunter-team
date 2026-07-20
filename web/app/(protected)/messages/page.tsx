import { getMessagesHistory } from "@/lib/queries";
import MessagesList from "@/app/components/MessagesList";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const messages = await getMessagesHistory(200);

  // Niente wrapper con padding: la chat gestisce da sé l'altezza piena
  // (selettore sezioni + thread scrollabile + composer centrato).
  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <MessagesList initialMessages={messages} />
    </div>
  );
}
