/**
 * API Explorer — catalogo endpoint: scansiona web/app/api/ per route.ts
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type EndpointInfo = { method: HttpMethod; path: string; module: string; description: string; params?: string };

const API_DIR = path.join(process.cwd(), 'app', 'api');

const METHOD_REGEX = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
const COMMENT_REGEX = /\/\*\*[\s\S]*?\*\//;
const SEARCH_PARAMS_REGEX = /searchParams\.get\(['"](\w+)['"]\)/g;
const BODY_REGEX = /const\s*\{([^}]+)\}\s*=\s*(?:body|await\s+req\.json\(\))/;

function extractDescription(content: string): string {
  const m = content.match(COMMENT_REGEX);
  if (!m) return '';
  return m[0].replace(/\/\*\*|\*\/|\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function extractParams(content: string, method: HttpMethod): string {
  if (method === 'GET') {
    const params: string[] = [];
    let m; while ((m = SEARCH_PARAMS_REGEX.exec(content)) !== null) params.push(m[1]);
    return params.length > 0 ? `?${params.map(p => `${p}=`).join('&')}` : '';
  }
  const bodyMatch = content.match(BODY_REGEX);
  if (bodyMatch) return `body: { ${bodyMatch[1].trim()} }`;
  return '';
}

function scanApiDir(dir: string, prefix: string): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return endpoints; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const seg = entry.name.startsWith('[') ? `:${entry.name.replace(/[\[\]\.]/g, '')}` : entry.name;
      endpoints.push(...scanApiDir(path.join(dir, entry.name), `${prefix}/${seg}`));
      continue;
    }
    if (entry.name !== 'route.ts') continue;
    const filePath = path.join(dir, entry.name);
    let content: string;
    try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }

    const description = extractDescription(content);
    const module = prefix.split('/').filter(Boolean)[0] ?? 'root';
    let m;
    while ((m = METHOD_REGEX.exec(content)) !== null) {
      const method = m[1] as HttpMethod;
      endpoints.push({ method, path: `/api${prefix}`, module, description, params: extractParams(content, method) });
    }
    METHOD_REGEX.lastIndex = 0;
  }
  return endpoints;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const moduleFilter = searchParams.get('module');
  const methodFilter = searchParams.get('method');

  let endpoints = scanApiDir(API_DIR, '');
  if (moduleFilter) endpoints = endpoints.filter(e => e.module === moduleFilter);
  if (methodFilter) endpoints = endpoints.filter(e => e.method === methodFilter);
  endpoints.sort((a, b) => a.module.localeCompare(b.module) || a.path.localeCompare(b.path));

  const modules = [...new Set(endpoints.map(e => e.module))].sort();
  const grouped: Record<string, EndpointInfo[]> = {};
  for (const e of endpoints) { (grouped[e.module] ??= []).push(e); }

  return NextResponse.json({ endpoints, modules, grouped, total: endpoints.length });
}
