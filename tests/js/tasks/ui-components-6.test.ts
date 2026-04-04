/** Test UI batch 6 — Card, AlertBanner, Badge (LoadingButton non esiste) */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Card ── */
describe("Card", () => {
  const src = readSrc("app/components/Card.tsx");

  it("export Card + CardGrid + StatCard + tipi CardVariant/CardPadding + 3 interface", () => {
    expect(src).toMatch(/export function Card\b/);
    expect(src).toMatch(/export function CardGrid\b/);
    expect(src).toMatch(/export function StatCard\b/);
    expect(src).toContain("export type CardVariant"); expect(src).toContain("export type CardPadding");
    expect(src).toContain("export interface CardProps");
    expect(src).toContain("export interface CardGridProps");
    expect(src).toContain("export interface StatCardProps");
  });

  it("VARIANT_STYLE 3: default/outlined/elevated + borderRadius 12", () => {
    expect(src).toContain("VARIANT_STYLE");
    for (const v of ["default", "outlined", "elevated"]) expect(src).toContain(`${v}:`);
    expect(src).toContain("borderRadius: 12");
    expect(src).toContain("boxShadow: 'none'"); // default + outlined
    expect(src).toContain("background: 'transparent'"); // outlined
  });

  it("PADDING_CLS 4 livelli + HEADER_PAD + FOOTER_PAD maps", () => {
    expect(src).toContain("PADDING_CLS"); expect(src).toContain("HEADER_PAD"); expect(src).toContain("FOOTER_PAD");
    for (const p of ["none", "sm", "md", "lg"]) expect(src).toContain(`${p}:`);
    expect(src).toContain("p-3"); expect(src).toContain("p-5"); expect(src).toContain("p-7");
  });

  it("header: title + subtitle + action slot, footer con borderTop", () => {
    expect(src).toContain("hasHeader"); expect(src).toContain("{title}"); expect(src).toContain("{subtitle}");
    expect(src).toContain("{action}"); expect(src).toContain("{footer}"); expect(src).toContain("borderTop");
  });

  it("hoverable + onClick → role='button' + tabIndex 0 + keyboard Enter/Space", () => {
    expect(src).toContain("hoverable"); expect(src).toContain("isClickable");
    expect(src).toContain("card-interactive");
    expect(src).toContain("role={isClickable ? 'button'");
    expect(src).toContain("tabIndex={isClickable ? 0");
    expect(src).toContain("'Enter'"); expect(src).toContain("' '");
    expect(src).toContain("scale(0.995)"); // active
  });

  it("CardGrid: cols 1-4 responsive + COLS/GAPS maps", () => {
    expect(src).toContain("COLS"); expect(src).toContain("GAPS");
    expect(src).toContain("grid-cols-1"); expect(src).toContain("sm:grid-cols-2");
    expect(src).toContain("lg:grid-cols-3"); expect(src).toContain("lg:grid-cols-4");
    for (const g of ["gap-3", "gap-5", "gap-7"]) expect(src).toContain(g);
  });

  it("StatCard: label + value + trend ↑↓ verde/rosso + sub opzionale", () => {
    expect(src).toContain("trendColor");
    expect(src).toContain("var(--color-green)"); expect(src).toContain("var(--color-red)");
    expect(src).toContain("Math.abs(trend)");
  });
});

/* ── AlertBanner ── */
describe("AlertBanner", () => {
  const src = readSrc("app/components/AlertBanner.tsx");

  it("export AlertBanner + AlertBannerStack + AlertType + 3 interface", () => {
    expect(src).toMatch(/export function AlertBanner\b/);
    expect(src).toMatch(/export function AlertBannerStack\b/);
    expect(src).toContain("export type AlertType");
    expect(src).toContain("export interface AlertBannerProps");
    expect(src).toContain("export interface BannerItem");
    expect(src).toContain("export interface AlertBannerStackProps");
  });

  it("TYPE_STYLE + ACTION_STYLE per 4 tipi: info/warning/error/success", () => {
    expect(src).toContain("TYPE_STYLE"); expect(src).toContain("ACTION_STYLE");
    for (const t of ["info", "warning", "error", "success"]) expect(src).toContain(`${t}:`);
  });

  it("Icon component SVG per tipo: polyline (success), circle (error/info), path (warning)", () => {
    expect(src).toContain("function Icon");
    expect(src).toContain("polyline"); expect(src).toContain("<circle"); expect(src).toContain("<path");
  });

  it("role='alert' + aria-label='Chiudi' + banner-slide-down animation", () => {
    expect(src).toContain('role="alert"'); expect(src).toContain('aria-label="Chiudi"');
    expect(src).toContain("banner-slide-down");
    expect(src).toContain("translateY(-100%)"); expect(src).toContain("translateY(0)");
  });

  it("dismissible + action CTA (label+onClick) + position fixed/inline + zIndex 100", () => {
    expect(src).toContain("dismissible"); expect(src).toContain("setVisible(false)");
    expect(src).toContain("action.label"); expect(src).toContain("action.onClick");
    expect(src).toContain("position: 'fixed'"); expect(src).toContain("position: 'relative'");
    expect(src).toContain("zIndex: 100");
  });

  it("AlertBannerStack: banners.map position='inline' + onDismiss(id)", () => {
    expect(src).toContain("banners.map");
    expect(src).toContain('position="inline"');
    expect(src).toContain("onDismiss={() => onDismiss(b.id)}");
  });
});

/* ── Badge ── */
describe("Badge", () => {
  const src = readSrc("app/components/Badge.tsx");

  it("export Badge + BadgeGroup + StatusBadge + CountBadge", () => {
    expect(src).toMatch(/export function Badge\b/);
    expect(src).toMatch(/export function BadgeGroup\b/);
    expect(src).toMatch(/export function StatusBadge\b/);
    expect(src).toMatch(/export function CountBadge\b/);
  });

  it("BadgeVariant 6 + BadgeSize 3 + tipi esportati", () => {
    expect(src).toContain("export type BadgeVariant"); expect(src).toContain("export type BadgeSize");
    for (const v of ["default", "success", "warning", "error", "info", "outline"]) expect(src).toContain(`${v}:`);
  });

  it("VARIANT + DOT_COLOR + SIZE_CLS + DOT_PX + RMV_PX + ICN_PX maps", () => {
    for (const m of ["VARIANT", "DOT_COLOR", "SIZE_CLS", "DOT_PX", "RMV_PX", "ICN_PX"])
      expect(src).toContain(m);
  });

  it("dot puro (no label) + dot prefix + removable aria-label='Rimuovi'", () => {
    expect(src).toContain("dot && !label"); expect(src).toContain("removable");
    expect(src).toContain('aria-label="Rimuovi"'); expect(src).toContain("onRemove?.()");
  });

  it("STATUS_MAP: attivo/completato/errore/pending/merged → varianti", () => {
    expect(src).toContain("STATUS_MAP");
    for (const s of ["attivo", "completato", "errore", "pending", "merged"]) expect(src).toContain(`${s}:`);
  });

  it("CountBadge: count > max → '99+' + BadgeGroupProps wrap/gap", () => {
    expect(src).toContain("count > max"); expect(src).toContain("`${max}+`");
    expect(src).toContain("export interface BadgeGroupProps"); expect(src).toContain("wrap");
  });
});
