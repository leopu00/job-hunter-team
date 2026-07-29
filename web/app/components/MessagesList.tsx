"use client";

// [JHT-MESSAGES-CHAT] /messages come chat stile messenger (scelta utente
// 20/07): sidebar sinistra con le tre conversazioni — Assistente, Mentor,
// Capitano — e, sotto, la presentazione dell'agente selezionato; a destra
// il thread di bolle con composer centrato stile ChatGPT.
//
// [JHT-CHAT-UNIFY] Due cambi di sostanza:
//  · si SCRIVE, non si "risponde". Prima il composer si agganciava
//    all'ultimo messaggio dell'agente ancora senza `user_reply` e, quando
//    non ce n'erano, si spegneva mostrando "Nessun messaggio in attesa di
//    risposta" — cioè quasi sempre. Ora ogni turno è una riga
//    (`author='user'`), il composer è sempre vivo e il messaggio arriva al
//    pane tmux dell'agente entro pochi secondi.
//  · le icone sono i ritratti disegnati (AgentAvatar), non emoji.
// Le vecchie `user_reply` continuano a rendersi: le conversazioni già
// salvate restano leggibili com'erano.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import {
  agentInfo,
  formatRelative,
  kindLabel,
  KIND_BORDER,
} from "@/lib/message-display";
import MessageBody from "@/app/components/MessageBody";
import AgentAvatar from "@/app/components/AgentAvatar";
import { usePendingMessagesLive } from "@/app/hooks/usePendingMessagesLive";
import {
  THREAD_T,
  optimisticUserTurn,
  postAcks,
  postChat,
  unreadIdsOf,
  withAgentAcked,
  withConfirmedTurn,
  withoutTurn,
} from "@/lib/messages-thread";
import { CHAT_AGENTS, MAX_CHAT_BODY } from "@/lib/chat-agents";
import type { PendingMessage } from "@/lib/types";

interface Props {
  initialMessages: PendingMessage[];
}

// Le tre conversazioni del web, nell'ordine voluto dall'utente. Sono FISSE:
// con gli altri agenti si parla dal videogioco, dove ognuno ha il suo
// pannello. Un messaggio arrivato da un mittente fuori da questa lista
// resta nel drawer della navbar, non apre una quarta chat qui.
const CORE_AGENTS: readonly string[] = CHAT_AGENTS;

// Presentazione dell'agente selezionato (prosa, niente etichette):
// sintesi dei prompt in agents/{assistente,mentor,capitano}/*.md.
const AGENT_BIO: Record<string, Record<string, string>> = {
  assistente: {
    it: "L'Assistente ti accompagna dalla configurazione in poi: costruisce e aggiorna il tuo profilo, smista i documenti che carichi e traduce le tue richieste in ordini per il resto del team.\n\nÈ la prima porta a cui bussare: chiedile di aggiornare il profilo, di spiegarti come funziona la piattaforma o di far arrivare un'istruzione al Capitano.",
    en: "The Assistant walks you through setup and beyond: it builds and updates your profile, sorts the documents you upload and turns your requests into orders for the rest of the team.\n\nIt's the first door to knock on: ask it to update your profile, explain how the platform works, or pass an instruction along to the Captain.",
    es: "La Asistente te acompaña desde la configuración en adelante: construye y actualiza tu perfil, organiza los documentos que subes y convierte tus peticiones en órdenes para el resto del equipo.\n\nEs la primera puerta a la que llamar: pídele actualizar el perfil, explicarte cómo funciona la plataforma o hacer llegar una instrucción al Capitán.",
    fr: "L'Assistante vous accompagne depuis la configuration : elle construit et met à jour votre profil, trie les documents que vous téléversez et traduit vos demandes en ordres pour le reste de l'équipe.\n\nC'est la première porte à laquelle frapper : demandez-lui de mettre à jour le profil, d'expliquer le fonctionnement de la plateforme ou de transmettre une instruction au Capitaine.",
    de: "Die Assistentin begleitet dich von der Einrichtung an: Sie baut und aktualisiert dein Profil, sortiert hochgeladene Dokumente und übersetzt deine Wünsche in Aufträge für den Rest des Teams.\n\nSie ist die erste Anlaufstelle: Bitte sie, das Profil zu aktualisieren, die Plattform zu erklären oder eine Anweisung an den Kapitän weiterzugeben.",
    hu: "Az Asszisztens a beállítástól kezdve végigkísér: felépíti és frissíti a profilod, rendszerezi a feltöltött dokumentumokat, és a kéréseidet utasításokká fordítja a csapat többi tagja felé.\n\nŐ az első ajtó, amin kopogtass: kérd meg a profil frissítésére, a platform elmagyarázására, vagy hogy juttasson el egy utasítást a Kapitánynak.",
    pt: "A Assistente acompanha você desde a configuração: constrói e atualiza seu perfil, organiza os documentos que você envia e transforma seus pedidos em ordens para o resto da equipe.\n\nÉ a primeira porta para bater: peça para atualizar o perfil, explicar como a plataforma funciona ou levar uma instrução ao Capitão.",
  },
  mentor: {
    it: "Il Mentor è il tuo consigliere di carriera. Non tocca la pipeline: osserva l'insieme delle tue candidature, legge i pattern del mercato e ti dice cosa conviene — anche quando è scomodo.\n\nParlagli di obiettivi e dubbi di percorso: gap di skill da colmare, trend nelle risposte che ricevi, se una strada merita il tuo tempo.",
    en: "The Mentor is your career adviser. It never touches the pipeline: it watches your applications as a whole, reads market patterns and tells you what pays off — even when it's uncomfortable.\n\nTalk to it about goals and doubts along the way: skill gaps to close, trends in the responses you get, whether a path deserves your time.",
    es: "El Mentor es tu consejero de carrera. No toca la pipeline: observa el conjunto de tus candidaturas, lee los patrones del mercado y te dice qué conviene — aunque sea incómodo.\n\nHáblale de objetivos y dudas de camino: gaps de skills por cerrar, tendencias en las respuestas que recibes, si un camino merece tu tiempo.",
    fr: "Le Mentor est votre conseiller de carrière. Il ne touche pas à la pipeline : il observe l'ensemble de vos candidatures, lit les tendances du marché et vous dit ce qui vaut le coup — même quand c'est inconfortable.\n\nParlez-lui d'objectifs et de doutes de parcours : lacunes de compétences à combler, tendances dans les réponses reçues, si une voie mérite votre temps.",
    de: "Der Mentor ist dein Karriereberater. Er rührt die Pipeline nicht an: Er betrachtet deine Bewerbungen als Ganzes, liest Marktmuster und sagt dir, was sich lohnt — auch wenn es unbequem ist.\n\nSprich mit ihm über Ziele und Zweifel: Skill-Lücken, Trends in den Antworten, ob ein Weg deine Zeit verdient.",
    hu: "A Mentor a karrier-tanácsadód. A pipeline-hoz nem nyúl: a jelentkezéseidet egészében nézi, kiolvassa a piaci mintázatokat, és megmondja, mi éri meg — akkor is, ha kényelmetlen.\n\nBeszélj vele célokról és kétségekről: pótolandó skill-hiányokról, a kapott válaszok trendjeiről, arról, hogy megér-e egy irány.",
    pt: "O Mentor é seu conselheiro de carreira. Não toca na pipeline: observa suas candidaturas como um todo, lê os padrões do mercado e diz o que vale a pena — mesmo quando é desconfortável.\n\nFale com ele sobre objetivos e dúvidas de percurso: gaps de skills a fechar, tendências nas respostas que você recebe, se um caminho merece seu tempo.",
  },
  capitano: {
    it: "Il Capitano coordina la pipeline: decide quanti Scout, Analisti, Scorer e Scrittori lavorano e su cosa, tenendo d'occhio budget e priorità.\n\nRivolgiti a lui per lo stato della ricerca, per cambiare le priorità o per mettere più forze su un fronte — ad esempio un altro Scout, o il CV di una posizione che hai scelto.",
    en: "The Captain coordinates the pipeline: it decides how many Scouts, Analysts, Scorers and Writers work — and on what — while keeping an eye on budget and priorities.\n\nGo to it for the state of the search, to change priorities, or to put more force on a front — another Scout, say, or the CV for a position you picked.",
    es: "El Capitán coordina la pipeline: decide cuántos Scouts, Analistas, Scorers y Redactores trabajan — y en qué — vigilando presupuesto y prioridades.\n\nAcude a él por el estado de la búsqueda, para cambiar prioridades o para poner más fuerza en un frente — otro Scout, por ejemplo, o el CV de una posición que elegiste.",
    fr: "Le Capitaine coordonne la pipeline : il décide combien de Scouts, Analystes, Scorers et Rédacteurs travaillent — et sur quoi — en surveillant budget et priorités.\n\nAdressez-vous à lui pour l'état de la recherche, changer les priorités ou renforcer un front — un Scout de plus, par exemple, ou le CV d'un poste que vous avez choisi.",
    de: "Der Kapitän koordiniert die Pipeline: Er entscheidet, wie viele Scouts, Analysten, Scorer und Schreiber woran arbeiten — mit Blick auf Budget und Prioritäten.\n\nWende dich an ihn für den Stand der Suche, geänderte Prioritäten oder mehr Kraft an einer Front — etwa ein weiterer Scout oder das CV für eine gewählte Stelle.",
    hu: "A Kapitány koordinálja a pipeline-t: eldönti, hány Scout, Elemző, Scorer és Író dolgozik — és min —, közben figyeli a keretet és a prioritásokat.\n\nHozzá fordulj a keresés állapotáért, a prioritások módosításáért, vagy ha erősítést kérnél egy fronton — például még egy Scoutot, vagy CV-t egy kiválasztott állásra.",
    pt: "O Capitão coordena a pipeline: decide quantos Scouts, Analistas, Scorers e Escritores trabalham — e em quê — de olho no orçamento e nas prioridades.\n\nProcure-o pelo estado da busca, para mudar prioridades ou reforçar uma frente — mais um Scout, por exemplo, ou o CV de uma vaga que você escolheu.",
  },
};

const T: Record<string, Record<string, string>> = {
  ...THREAD_T,
  empty_agent: {
    it: "Nessun messaggio da {name}, per ora.",
    en: "No messages from {name} yet.",
    hu: "Egyelőre nincs üzenet tőle: {name}.",
    es: "Aún no hay mensajes de {name}.",
    de: "Noch keine Nachrichten von {name}.",
    fr: "Pas encore de messages de {name}.",
    pt: "Ainda não há mensagens de {name}.",
  },
  // Le stringhe condivise col drawer stanno in THREAD_T (spread sopra);
  // questa è solo di questa vista — il bottone che riporta in fondo al thread.
  to_bottom: {
    it: "Vai all'ultimo messaggio",
    en: "Jump to latest message",
    hu: "Ugrás a legutóbbi üzenetre",
    es: "Ir al último mensaje",
    de: "Zur neuesten Nachricht",
    fr: "Aller au dernier message",
    pt: "Ir para a última mensagem",
  },
};

export default function MessagesList({ initialMessages }: Props) {
  // Solo i turni delle tre conversazioni: un mittente fuori roster non deve
  // comparire qui (resta nel drawer della navbar, che li mostra tutti).
  const [messages, setMessages] = useState<PendingMessage[]>(() =>
    initialMessages.filter((m) => CORE_AGENTS.includes(m.agent)),
  );
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Altezza del pannello MISURATA: (viewport - top del pannello) / zoom
  // effettivo, derivato dal rapporto rect/offset del pannello stesso.
  // Robusto rispetto alle diverse semantiche zoom×dvh dei Chromium (il
  // calc statico 100dvh/--zoom tornava ~150px in più su Chrome Canary →
  // pagina scrollabile con vuoto nero sotto il composer).
  //
  // Su iOS 26 la barra di Safari GALLEGGIA sopra la pagina: misurato sul
  // simulatore, innerHeight e visualViewport.height valgono entrambi 714 e
  // ignorano la fascia coperta, mentre 100svh vale 621 — l'altezza davvero
  // libera. Con 714 il composer finiva sotto la barra. Misuriamo quindi
  // `svh` con una probe (statico: non insegue la barra che si contrae, così
  // il layout non sobbalza a ogni scroll) e teniamo innerHeight come
  // fallback per i browser senza svh.
  const [panelH, setPanelH] = useState<number | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const smallViewportH = () => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:absolute;top:-9999px;left:0;width:1px;height:100svh;pointer-events:none";
      document.body.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h > 0 ? h : 0;
    };
    const apply = () => {
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
      const topDoc = rect.top + window.scrollY;
      // Il minimo tra i due: svh toglie la barra del browser, visualViewport
      // toglie la tastiera quando si apre (svh, statico, non la vede).
      const candidates = [
        smallViewportH(),
        window.visualViewport?.height ?? 0,
        window.innerHeight,
      ].filter((v) => v > 0);
      const viewH = Math.min(...candidates);
      setPanelH(Math.max(320, Math.floor((viewH - topDoc) / zoom)));
    };
    apply();
    window.addEventListener("resize", apply);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      vv?.removeEventListener("resize", apply);
    };
  }, []);

  // Il documento non deve MAI scrollare su questa pagina: lo scroll è del
  // solo thread. Senza questo, l'overscroll in fondo alle bolle si propaga
  // alla pagina e porta fuori schermo selettore agenti e composer (su iOS
  // basta un pixel di eccedenza). Ripristinato all'uscita dalla pagina.
  useEffect(() => {
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  const agents = CORE_AGENTS;

  // Conversazione iniziale: l'agente col messaggio più recente, altrimenti
  // l'Assistente (prima voce).
  const [activeAgent, setActiveAgent] = useState<string>(() => {
    const latest = [...initialMessages]
      .filter((m) => CORE_AGENTS.includes(m.agent))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return latest?.agent ?? "assistente";
  });

  const thread = useMemo(
    () =>
      messages
        .filter((m) => m.agent === activeAgent)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages, activeAgent],
  );

  // Non letti = turni dell'AGENTE non ancora ack-ati: quelli scritti
  // dall'utente nascono già letti.
  const unreadBy = (agent: string) =>
    messages.filter(
      (m) => m.agent === agent && m.author !== "user" && !m.acknowledged_at,
    ).length;

  // Aprire una conversazione marca i suoi non letti (stile messenger, come
  // nel drawer): ottimista + fire-and-forget, il server riallinea al reload.
  function ackAgent(agent: string) {
    const ids = unreadIdsOf(messages, agent);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setMessages((ms) => withAgentAcked(ms, agent, now));
    postAcks(ids);
  }

  // Ack anche della conversazione aperta di default al primo mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => ackAgent(activeAgent), [activeAgent]);

  // Mirror per il merge live (le callback Realtime non vedono lo state).
  const messagesRef = useRef<PendingMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const activeAgentRef = useRef(activeAgent);
  useEffect(() => {
    activeAgentRef.current = activeAgent;
  }, [activeAgent]);

  // [JHT-MSG-REALTIME] Nuovi messaggi e aggiornamenti arrivano via websocket
  // Supabase (zero Vercel, zero polling): merge in place; se la conversazione
  // è quella aperta, il messaggio viene ackato subito (l'utente lo sta
  // guardando), come farebbe openChat.
  usePendingMessagesLive(
    useCallback((row, event) => {
      // [JHT-CHAT-UNIFY] Niente più filtro su `delivered_via`: una risposta
      // spinta anche su Telegram resta parte della conversazione e deve
      // comparire qui. Si filtra invece per conversazione: le tre del web.
      if (!CORE_AGENTS.includes(row.agent)) return;
      const cur = messagesRef.current;
      const idx = cur.findIndex((m) => m.id === row.id);
      if (idx < 0 && event === "UPDATE") return; // fuori finestra: ignora
      let merged: PendingMessage;
      if (idx >= 0) {
        const prev = cur[idx];
        merged = {
          ...row,
          acknowledged_at: row.acknowledged_at ?? prev.acknowledged_at,
          user_reply: row.user_reply ?? prev.user_reply,
          user_reply_at: row.user_reply_at ?? prev.user_reply_at,
        };
        const next = [...cur];
        next[idx] = merged;
        setMessages(next);
      } else {
        merged = row;
        if (
          merged.agent === activeAgentRef.current &&
          !merged.acknowledged_at
        ) {
          merged = { ...merged, acknowledged_at: new Date().toISOString() };
          void fetch(`/api/pending-messages/${merged.id}/ack`, {
            method: "POST",
          }).catch(() => {});
        }
        setMessages([merged, ...cur]);
      }
    }, []),
  );

  // "Sei in fondo?": comanda sia il pulsante di ritorno all'ultimo messaggio
  // sia l'auto-scroll (un messaggio in arrivo non deve strappare la lettura
  // a chi sta scorrendo lo storico più in alto).
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const readAtBottom = useCallback(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // Scroll in fondo SOLO dentro il contenitore del thread: scrollIntoView
  // scrollava anche gli antenati (documento incluso) creando il "vuoto
  // nero" sotto il composer.
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
  }, [activeAgent]);

  useEffect(() => {
    if (!atBottomRef.current) return; // l'utente sta leggendo più in alto
    const el = threadScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // L'altezza misurata arriva DOPO il primo paint (e il testo delle bolle si
  // riflowa quando il font è pronto): senza questo riaggancio la chat si
  // apriva a metà storico invece che sull'ultimo messaggio.
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    const t = setTimeout(() => ro.disconnect(), 2000);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [panelH, activeAgent]);

  // Il messaggio parte SEMPRE: non c'è più un "bersaglio" da agganciare.
  // La bolla compare subito (ottimistica) e viene sostituita dalla riga
  // vera appena il server risponde; se l'invio fallisce sparisce e il testo
  // torna nel composer, così non si perde quello che si era scritto.
  async function handleSend() {
    const text = replyText.trim();
    if (!text || sending) return;
    const agent = activeAgent;
    const optimistic = optimisticUserTurn(agent, text);
    setSending(true);
    setError(null);
    setReplyText("");
    setMessages((ms) => [optimistic, ...ms]);
    try {
      const confirmed = await postChat(agent, text);
      setMessages((ms) => withConfirmedTurn(ms, optimistic.id, confirmed));
    } catch (e) {
      setMessages((ms) => withoutTurn(ms, optimistic.id));
      setReplyText(text);
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const activeInfo = agentInfo(activeAgent, locale);
  const activeBio =
    AGENT_BIO[activeAgent]?.[locale] ?? AGENT_BIO[activeAgent]?.en;

  // Voce della lista agenti (sidebar desktop + riga mobile).
  function agentButton(agent: string, compact: boolean) {
    const info = agentInfo(agent, locale);
    const unread = unreadBy(agent);
    const active = agent === activeAgent;
    return (
      <button
        key={agent}
        type="button"
        onClick={() => setActiveAgent(agent)}
        aria-pressed={active}
        className={
          compact
            ? "flex items-center gap-2 px-4 py-3 cursor-pointer transition-colors"
            : "w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer rounded-lg transition-colors"
        }
        style={{
          color: active ? info.color : "var(--color-muted)",
          background: !compact && active ? "var(--color-card)" : "transparent",
          boxShadow:
            compact && active ? `inset 0 -2px 0 0 ${info.color}` : undefined,
        }}
      >
        <AgentAvatar
          agent={agent}
          locale={locale}
          size={compact ? 22 : 36}
          ring={!compact}
        />
        <span className="text-[11px] font-bold tracking-wide flex-1 min-w-0 truncate">
          {info.name}
        </span>
        {unread > 0 && (
          <span
            className="min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center text-[8px] font-bold leading-none"
            style={{
              background: "var(--color-yellow)",
              color: "var(--color-void)",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    // Altezza piena sotto la navbar: valore SSR di partenza col calc
    // 100svh/--zoom, poi corretto dalla misura a runtime (vedi sopra).
    <div
      ref={rootRef}
      className="flex flex-col md:flex-row"
      style={{
        height:
          panelH != null ? panelH : "calc(100svh / var(--zoom, 1) - 56px)",
      }}
    >
      {/* ── Sidebar sinistra: conversazioni + presentazione ────────── */}
      <aside className="hidden md:flex w-[280px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="p-3 flex flex-col gap-1">
          {agents.map((a) => agentButton(a, false))}
        </div>
        {/* Presentazione dell'agente selezionato: usa lo spazio restante. */}
        {activeBio && (
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-[var(--color-border)] px-5 py-5">
            <div className="flex items-center gap-2.5 mb-3">
              <AgentAvatar agent={activeAgent} locale={locale} size={30} ring />
              <span
                className="text-[13px] font-bold"
                style={{ color: activeInfo.color }}
              >
                {activeInfo.name}
              </span>
            </div>
            <p
              className="m-0 text-[11.5px] leading-relaxed text-[var(--color-muted)]"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {activeBio}
            </p>
          </div>
        )}
      </aside>

      {/* ── Selettore mobile (la sidebar sparisce sotto md) ────────── */}
      <div className="md:hidden shrink-0 border-b border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="flex items-stretch justify-center gap-1">
          {agents.map((a) => agentButton(a, true))}
        </div>
      </div>

      {/* ── Colonna chat ───────────────────────────────────────────── */}
      {/* min-h-0 NON è decorativo: su mobile il root è flex-column e senza
          di esso questa colonna non scende sotto l'altezza del thread
          (min-height:auto), sfora il pannello e a scrollare se ne va
          l'intera pagina — header e composer inclusi. */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="relative flex-1 min-h-0">
          <div
            ref={threadScrollRef}
            onScroll={readAtBottom}
            className="h-full overflow-y-auto overflow-x-hidden"
            // overscroll contain: arrivati a fine thread lo slancio non passa
            // al documento (inline, non via classe: vedi nota sulle utility
            // rare assenti dal CSS in cache su Safari).
            style={{ overscrollBehavior: "contain" }}
          >
            <div
              className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-4"
              style={{ animation: "fade-in 0.25s ease both" }}
            >
              {thread.length === 0 && (
                <p className="text-[12px] text-[var(--color-muted)] text-center py-12 m-0">
                  {tr("empty_agent").replace("{name}", activeInfo.name)}
                </p>
              )}
              {thread.map((m) => (
                <div key={m.id} className="flex flex-col gap-2">
                  {/* Turno scritto dall'utente: una riga a sé (author='user'),
                      non più una reply appesa a un messaggio dell'agente. */}
                  {m.author === "user" ? (
                    <div
                      className="max-w-[85%] self-end rounded-lg rounded-br-sm px-4 py-3"
                      style={{
                        background:
                          "color-mix(in srgb, var(--color-green) 10%, var(--color-card))",
                        border:
                          "1px solid color-mix(in srgb, var(--color-green) 30%, transparent)",
                        // Un turno non ancora confermato dal server resta
                        // leggermente smorzato: la conferma è visibile.
                        opacity: m.id.startsWith("pending:") ? 0.65 : 1,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1.5 justify-end">
                        <span className="text-[9px] font-semibold text-[var(--color-green)]">
                          {tr("you")}
                        </span>
                        <span className="text-[9px] text-[var(--color-dim)]">
                          {formatRelative(m.created_at, locale)}
                        </span>
                      </div>
                      <MessageBody
                        text={m.body}
                        className="m-0 text-[12.5px] leading-relaxed text-[var(--color-base)]"
                      />
                    </div>
                  ) : (
                    <>
                      {/* Bolla dell'agente */}
                      <div className="flex items-end gap-2 max-w-[85%] self-start">
                        <AgentAvatar
                          agent={m.agent}
                          locale={locale}
                          size={22}
                          className="mb-1"
                        />
                        <div
                          className="rounded-lg rounded-bl-sm px-4 py-3 border-l-2 min-w-0"
                          style={{
                            background: "var(--color-card)",
                            borderLeftColor: KIND_BORDER[m.kind],
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            {m.kind !== "notification" && (
                              <span
                                className="text-[7.5px] font-semibold tracking-[0.14em] uppercase px-1 py-px rounded"
                                style={{
                                  color: KIND_BORDER[m.kind],
                                  border: `1px solid ${KIND_BORDER[m.kind]}`,
                                }}
                              >
                                {kindLabel(m.kind, locale)}
                              </span>
                            )}
                            <span className="text-[9px] text-[var(--color-dim)]">
                              {formatRelative(m.created_at, locale)}
                            </span>
                          </div>
                          <MessageBody
                            text={m.body}
                            className="m-0 text-[12.5px] leading-relaxed text-[var(--color-base)]"
                          />
                          {m.related_position_id && (
                            <Link
                              href={`/positions/${m.related_position_id}`}
                              className="inline-block mt-1.5 text-[10px] text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                            >
                              {tr("see_position")}
                            </Link>
                          )}
                        </div>
                      </div>
                      {/* Risposta dell'utente */}
                      {m.user_reply && (
                        <div
                          className="max-w-[85%] self-end rounded-lg rounded-br-sm px-4 py-3"
                          style={{
                            background:
                              "color-mix(in srgb, var(--color-green) 10%, var(--color-card))",
                            border:
                              "1px solid color-mix(in srgb, var(--color-green) 30%, transparent)",
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1.5 justify-end">
                            <span className="text-[9px] font-semibold text-[var(--color-green)]">
                              {tr("you")}
                            </span>
                            {m.user_reply_at && (
                              <span className="text-[9px] text-[var(--color-dim)]">
                                {formatRelative(m.user_reply_at, locale)}
                              </span>
                            )}
                          </div>
                          <MessageBody
                            text={m.user_reply}
                            className="m-0 text-[12.5px] leading-relaxed text-[var(--color-base)]"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Ritorno all'ultimo messaggio: compare solo se il thread è
              scorso in alto (in fondo sarebbe rumore). */}
          {!atBottom && thread.length > 0 && (
            <button
              type="button"
              onClick={() => scrollToBottom()}
              aria-label={tr("to_bottom")}
              title={tr("to_bottom")}
              className="absolute bottom-3 right-4 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer border transition-colors"
              style={{
                background: "var(--color-card)",
                borderColor: "var(--color-border)",
                color: "var(--color-base)",
                boxShadow: "0 6px 18px rgba(0,0,0,0.28)",
                animation: "fade-in 0.18s ease both",
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* ── Composer centrato, stile ChatGPT ──────────────────────── */}
        {/* La barra flottante di Safari su iOS galleggia SOPRA la pagina:
            senza il safe-area inset il composer finisce sotto di essa. */}
        <div
          className="shrink-0 px-5 pt-2"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
          }}
        >
          <div className="max-w-2xl mx-auto">
            {error && (
              <div
                className="mb-2 px-3 py-1.5 rounded border text-[10px]"
                style={{
                  borderColor: "var(--color-red)",
                  color: "var(--color-red)",
                }}
                role="alert"
              >
                {error}
              </div>
            )}
            <div
              className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors focus-within:border-[var(--color-border-glow)]"
              style={{
                background: "var(--color-card)",
                borderColor: "var(--color-border)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              }}
            >
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                maxLength={MAX_CHAT_BODY}
                disabled={sending}
                placeholder={tr("write_to").replace("{name}", activeInfo.name)}
                className="flex-1 px-2 py-1.5 text-[12.5px] bg-transparent border-none resize-none text-[var(--color-base)] disabled:opacity-50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || replyText.trim().length === 0}
                aria-label={tr("send")}
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
                style={{
                  background: "var(--color-green)",
                  color: "var(--color-void)",
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
