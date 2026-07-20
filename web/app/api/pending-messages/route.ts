import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getMessagesHistory, getPendingMessagesCount } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Storico messaggi + conteggio non letti per il drawer messenger in navbar.
// Le query condivise gestiscono già il branch local (SQLite) / cloud (RLS):
// qui solo auth + serializzazione. Niente polling lato client: il drawer
// chiama questa route al mount e alle aperture.
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const [messages, unread] = await Promise.all([
    getMessagesHistory(100),
    getPendingMessagesCount(),
  ]);
  return NextResponse.json({ messages, unread });
}
