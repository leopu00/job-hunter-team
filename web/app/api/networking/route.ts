/**
 * API Networking — mappa contatti per azienda, suggerimenti, storico interazioni
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type Contact = { id: string; name: string; company: string; role: string; lastContact: number | null };
type CompanyNetwork = { company: string; contacts: Contact[]; hasApplication: boolean; openPositions: number };
type Suggestion = { action: string; target: string; reason: string; priority: 'high' | 'medium' | 'low' };
type Interaction = { contactName: string; company: string; type: string; date: number };

const CONTACTS_PATH = path.join(os.homedir(), '.jht', 'contacts.json');
const COMPANIES_PATH = path.join(os.homedir(), '.jht', 'companies.json');
const APPS_PATH = path.join(os.homedir(), '.jht', 'applications.json');

function loadJSON<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}

function buildNetworkMap(): CompanyNetwork[] {
  const contacts: Contact[] = loadJSON(CONTACTS_PATH, []);
  const companies: Array<{ name: string; openPositions: number }> = loadJSON(COMPANIES_PATH, []);
  const apps: Array<{ company: string }> = loadJSON(APPS_PATH, []);
  const appCompanies = new Set(apps.map(a => a.company));
  const grouped: Record<string, Contact[]> = {};
  for (const c of contacts) { (grouped[c.company] ??= []).push(c); }
  const allCompanies = new Set([...Object.keys(grouped), ...companies.map(c => c.name)]);
  return [...allCompanies].map(company => {
    const co = companies.find(c => c.name === company);
    return { company, contacts: grouped[company] ?? [], hasApplication: appCompanies.has(company), openPositions: co?.openPositions ?? 0 };
  }).sort((a, b) => b.contacts.length - a.contacts.length);
}

function generateSuggestions(network: CompanyNetwork[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (const n of network) {
    if (n.hasApplication && n.contacts.length === 0) {
      suggestions.push({ action: 'Trova contatto', target: n.company, reason: 'Hai una candidatura attiva ma nessun contatto interno', priority: 'high' });
    }
    if (n.openPositions > 0 && !n.hasApplication && n.contacts.length > 0) {
      suggestions.push({ action: 'Chiedi referral', target: `${n.contacts[0].name} (${n.company})`, reason: `${n.openPositions} posizioni aperte, hai già un contatto`, priority: 'high' });
    }
    for (const c of n.contacts) {
      if (c.lastContact && Date.now() - c.lastContact > 30 * 86400000) {
        suggestions.push({ action: 'Ricontatta', target: c.name, reason: `Ultimo contatto > 30 giorni fa (${n.company})`, priority: 'medium' });
      }
    }
    if (n.openPositions > 2 && n.contacts.length === 0) {
      suggestions.push({ action: 'Espandi network', target: n.company, reason: `${n.openPositions} posizioni aperte, nessun contatto`, priority: 'low' });
    }
  }
  return suggestions.sort((a, b) => { const p = { high: 0, medium: 1, low: 2 }; return p[a.priority] - p[b.priority]; }).slice(0, 10);
}

function recentInteractions(network: CompanyNetwork[]): Interaction[] {
  const interactions: Interaction[] = [];
  for (const n of network) {
    for (const c of n.contacts) {
      if (c.lastContact) interactions.push({ contactName: c.name, company: n.company, type: 'contatto', date: c.lastContact });
    }
  }
  return interactions.sort((a, b) => b.date - a.date).slice(0, 15);
}

export async function GET() {
  const network = buildNetworkMap();
  const suggestions = generateSuggestions(network);
  const interactions = recentInteractions(network);
  const totalContacts = network.reduce((s, n) => s + n.contacts.length, 0);
  const companiesWithContacts = network.filter(n => n.contacts.length > 0).length;
  return NextResponse.json({ network, suggestions, interactions, totalContacts, companiesWithContacts, totalCompanies: network.length });
}
