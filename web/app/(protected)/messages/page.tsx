import { getMessagesHistory } from "@/lib/queries";
import MessagesList from "@/app/components/MessagesList";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const messages = await getMessagesHistory(200);

  // Niente wrapper con padding: la chat gestisce da sé l'altezza piena
  // (selettore sezioni + thread scrollabile + composer centrato).
  // La chat a tutta pagina non fa una GET di suo — i messaggi arrivano da
  // qui e poi da Realtime — quindi l'ora del server gliela passiamo con
  // loro: senza, il suo orologio resterebbe quello del browser fino al
  // primo fetch, cioè proprio nei secondi in cui l'utente scrive.
  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <MessagesList
        initialMessages={messages}
        serverNowIso={new Date().toISOString()}
      />
    </div>
  );
}
