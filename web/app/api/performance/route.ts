/**
 * API Performance — Core Web Vitals, page load times, bundle size
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic'

interface CWVMetric { value: number; rating: 'good' | 'needs-improvement' | 'poor'; unit: string }
interface PagePerf { route: string; loadTimeMs: number; bundleKB: number; firstPaintMs: number }

function rateLCP(ms: number): CWVMetric['rating'] { return ms <= 2500 ? 'good' : ms <= 4000 ? 'needs-improvement' : 'poor'; }
function rateFID(ms: number): CWVMetric['rating'] { return ms <= 100 ? 'good' : ms <= 300 ? 'needs-improvement' : 'poor'; }
function rateCLS(v: number): CWVMetric['rating'] { return v <= 0.1 ? 'good' : v <= 0.25 ? 'needs-improvement' : 'poor'; }

function getPageRoutes(): string[] {
  const appDir = path.join(process.cwd(), 'app');
  const routes: string[] = [];
  const walk = (dir: string, prefix: string) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'api' || entry.name === 'components' || entry.name.startsWith('_')) continue;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
        else if (entry.name === 'page.tsx') routes.push(prefix || '/');
      }
    } catch { /* ignore */ }
  };
  walk(appDir, '');
  return routes.sort();
}

function estimateBundleSize(route: string): number {
  // Stima basata su complessita' route (no build analysis runtime)
  const depth = route.split('/').length;
  const base = 12 + Math.random() * 8;
  return Math.round((base + depth * 3) * 10) / 10;
}

function simulateLoadTime(route: string): number {
  const base = 80 + Math.random() * 120;
  const depth = route.split('/').length;
  return Math.round(base + depth * 15);
}

export async function GET() {
  const routes = getPageRoutes();

  // Core Web Vitals (simulati — in produzione verrebbero da RUM)
  const lcp = 1800 + Math.round(Math.random() * 800);
  const fid = 45 + Math.round(Math.random() * 60);
  const cls = Math.round((0.03 + Math.random() * 0.08) * 1000) / 1000;
  const ttfb = 120 + Math.round(Math.random() * 80);
  const inp = 80 + Math.round(Math.random() * 100);

  const cwv = {
    lcp: { value: lcp, rating: rateLCP(lcp), unit: 'ms' },
    fid: { value: fid, rating: rateFID(fid), unit: 'ms' },
    cls: { value: cls, rating: rateCLS(cls), unit: '' },
    ttfb: { value: ttfb, rating: ttfb <= 200 ? 'good' as const : 'needs-improvement' as const, unit: 'ms' },
    inp: { value: inp, rating: inp <= 200 ? 'good' as const : 'needs-improvement' as const, unit: 'ms' },
  };

  const pages: PagePerf[] = routes.map(route => ({
    route,
    loadTimeMs: simulateLoadTime(route),
    bundleKB: estimateBundleSize(route),
    firstPaintMs: 60 + Math.round(Math.random() * 80),
  }));

  const totalBundleKB = Math.round(pages.reduce((s, p) => s + p.bundleKB, 0) * 10) / 10;
  const avgLoadMs = Math.round(pages.reduce((s, p) => s + p.loadTimeMs, 0) / (pages.length || 1));

  return NextResponse.json({ cwv, pages, totalPages: pages.length, totalBundleKB, avgLoadMs });
}
