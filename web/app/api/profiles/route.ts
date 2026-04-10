/**
 * API Profiles — lista profili candidato con completezza e sezioni
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const dynamic = 'force-dynamic';

type Section = { name: string; filled: boolean; items: number };
type Profile = { id: string; name: string; role: string; completeness: number; sections: Section[]; updatedAt: number; source: string };

const CANDIDATO_DIR = path.join(os.homedir(), '.jht', 'candidato');
const PROFILES_DIR = path.join(os.homedir(), '.jht', 'profiles');

const SECTION_DEFS = ['esperienza', 'competenze', 'formazione', 'lingue', 'certificazioni', 'progetti', 'contatti'];

function parseProfileFile(filePath: string, id: string): Profile | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const isJson = filePath.endsWith('.json');
    if (isJson) {
      const data = JSON.parse(raw);
      const sections: Section[] = SECTION_DEFS.map(s => {
        const val = data[s] ?? data[s + 'List'] ?? data[s.charAt(0).toUpperCase() + s.slice(1)];
        const items = Array.isArray(val) ? val.length : (val ? 1 : 0);
        return { name: s, filled: items > 0, items };
      });
      const filled = sections.filter(s => s.filled).length;
      return { id, name: data.nome ?? data.name ?? id, role: data.ruolo ?? data.role ?? data.targetRole ?? '—', completeness: Math.round((filled / sections.length) * 100), sections, updatedAt: fs.statSync(filePath).mtimeMs, source: path.relative(os.homedir(), filePath) };
    }
    // Markdown/text — cerca sezioni con ## headers
    const sections: Section[] = SECTION_DEFS.map(s => {
      const regex = new RegExp(`##\\s*${s}`, 'i');
      const found = regex.test(raw);
      return { name: s, filled: found, items: found ? 1 : 0 };
    });
    const filled = sections.filter(s => s.filled).length;
    const nameMatch = raw.match(/^#\s+(.+)/m) ?? raw.match(/nome:\s*(.+)/im);
    const roleMatch = raw.match(/ruolo:\s*(.+)/im) ?? raw.match(/role:\s*(.+)/im);
    return { id, name: nameMatch?.[1]?.trim() ?? id, role: roleMatch?.[1]?.trim() ?? '—', completeness: Math.round((filled / sections.length) * 100), sections, updatedAt: fs.statSync(filePath).mtimeMs, source: path.relative(os.homedir(), filePath) };
  } catch { return null; }
}

function scanProfiles(): Profile[] {
  const profiles: Profile[] = [];
  for (const dir of [CANDIDATO_DIR, PROFILES_DIR]) {
    let files: string[];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.json') && !f.endsWith('.md') && !f.endsWith('.txt')) continue;
      const p = parseProfileFile(path.join(dir, f), f.replace(/\.(json|md|txt)$/, ''));
      if (p) profiles.push(p);
    }
  }
  if (profiles.length === 0) return [];
  return profiles;
}

function generateSampleProfiles(): Profile[] {
  const now = Date.now();
  const mkSections = (filled: number[]) => SECTION_DEFS.map((s, i) => ({ name: s, filled: filled.includes(i), items: filled.includes(i) ? Math.floor(Math.random() * 5 + 1) : 0 }));
  return [
    { id: 'profile-main', name: 'Leone Puglisi', role: 'Full Stack Developer', completeness: 86, sections: mkSections([0,1,2,3,4,5]), updatedAt: now - 3600000, source: 'sample' },
    { id: 'profile-ds', name: 'Leone Puglisi', role: 'Data Scientist', completeness: 57, sections: mkSections([0,1,2,3]), updatedAt: now - 86400000, source: 'sample' },
    { id: 'profile-pm', name: 'Leone Puglisi', role: 'Product Manager', completeness: 29, sections: mkSections([0,2]), updatedAt: now - 259200000, source: 'sample' },
  ];
}

export async function GET() {
  const profiles = scanProfiles().sort((a, b) => b.updatedAt - a.updatedAt);
  const avgCompleteness = profiles.length > 0 ? Math.round(profiles.reduce((s, p) => s + p.completeness, 0) / profiles.length) : 0;
  return NextResponse.json({ profiles, total: profiles.length, avgCompleteness });
}
