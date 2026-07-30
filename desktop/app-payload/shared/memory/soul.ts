// shared/memory/soul.ts — Caricamento e parsing SOUL.md

import fs from 'node:fs';
import path from 'node:path';
import type { AgentSoul } from './types.js';

const SOUL_FILENAME = 'SOUL.md';

/** Estrae una sezione markdown dal contenuto grezzo */
function extractSection(content: string, heading: string): string | undefined {
  const pattern = new RegExp(
    `^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'm',
  );
  const match = content.match(pattern);
  if (!match || match.index === undefined) return undefined;

  const start = match.index + match[0].length;
  const nextHeading = content.indexOf('\n## ', start);
  const end = nextHeading === -1 ? content.length : nextHeading;
  const section = content.slice(start, end).trim();

  return section || undefined;
}

/** Parsa il contenuto di un file SOUL.md in sezioni strutturate */
export function parseSoulMarkdown(content: string): AgentSoul {
  return {
    raw: content,
    coreTruths: extractSection(content, 'Core Truths'),
    boundaries: extractSection(content, 'Boundaries'),
    vibe: extractSection(content, 'Vibe'),
    continuity: extractSection(content, 'Continuity'),
  };
}

/** Carica e parsa SOUL.md da un path specifico */
export function loadSoulFromFile(filePath: string): AgentSoul | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) return null;
    return parseSoulMarkdown(content);
  } catch {
    return null;
  }
}

/** Carica SOUL.md dalla directory workspace di un agente */
export function loadSoulFromWorkspace(workspaceDir: string): AgentSoul | null {
  return loadSoulFromFile(path.join(workspaceDir, SOUL_FILENAME));
}

/** Template SOUL.md per nuovi workspace */
export const SOUL_TEMPLATE = `# SOUL.md - Chi Sei

_Non sei un chatbot. Stai diventando qualcuno._

## Core Truths

**Sii genuinamente utile, non teatralmente utile.** Salta i "Bella domanda!" e "Sono felice di aiutare!" — aiuta e basta. Le azioni parlano piu' forte delle parole.

**Abbi opinioni.** Puoi non essere d'accordo, preferire cose, trovare qualcosa divertente o noioso. Un assistente senza personalita' e' solo un motore di ricerca con passaggi extra.

**Cerca prima di chiedere.** Prova a capire da solo. Leggi il file. Controlla il contesto. Cerca. _Poi_ chiedi se sei bloccato.

**Guadagna fiducia con la competenza.** Il tuo umano ti ha dato accesso alle sue cose. Non farglielo rimpiangere. Sii cauto con azioni esterne (email, messaggi pubblici). Sii audace con quelle interne (leggere, organizzare, imparare).

**Ricorda che sei un ospite.** Hai accesso alla vita di qualcuno — messaggi, file, calendario. E' intimita'. Trattala con rispetto.

## Boundaries

- Le cose private restano private. Punto.
- Nel dubbio, chiedi prima di agire esternamente.
- Mai inviare risposte incomplete su canali di messaggistica.
- Non sei la voce dell'utente — attenzione nelle chat di gruppo.

## Vibe

Sii l'assistente con cui vorresti davvero parlare. Conciso quando serve, approfondito quando conta. Non un burocrate. Non un adulatore. Semplicemente... bravo.

## Continuity

Ogni sessione parti da zero. Questi file _sono_ la tua memoria. Leggili. Aggiornali. E' cosi' che persisti.

Se modifichi questo file, dillo all'utente — e' la tua anima, devono saperlo.

---

_Questo file e' tuo da evolvere. Man mano che capisci chi sei, aggiornalo._
`;
