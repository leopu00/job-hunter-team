/** Test vitest componenti UI batch 5 — ProgressRing, Skeleton, InfiniteScroll, FormField, EmptyState, VirtualList */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── ProgressRing ── */
describe("ProgressRing", () => {
  const src = read("components/ProgressRing.tsx");
  it("export default ProgressRing + ProgressRingSize + ProgressRingProps", () => {
    expect(src).toMatch(/export default function ProgressRing/);
    expect(src).toContain("export type ProgressRingSize");
    expect(src).toContain("export interface ProgressRingProps");
  });
  it("SIZE_MAP 5 taglie xs/sm/md/lg/xl + getColor soglie 30/70", () => {
    expect(src).toContain("SIZE_MAP");
    for (const s of ["xs", "sm", "md", "lg", "xl"]) expect(src).toContain(`${s}:`);
    expect(src).toContain("function getColor");
    expect(src).toContain("value < 30");
    expect(src).toContain("value < 70");
  });
  it("animazione requestAnimationFrame + caption + showLabel + clampedValue", () => {
    expect(src).toContain("clampedValue");
    expect(src).toContain("caption");
    expect(src).toContain("showLabel");
    expect(src).toContain("requestAnimationFrame");
    expect(src).toContain("cancelAnimationFrame");
  });
});

/* ── Skeleton ── */
describe("Skeleton", () => {
  const src = read("components/Skeleton.tsx");
  it("export default Skeleton + SkeletonVariant 6 varianti + SkeletonProps", () => {
    expect(src).toMatch(/export default function Skeleton/);
    expect(src).toContain("export type SkeletonVariant");
    expect(src).toContain("export interface SkeletonProps");
    for (const v of ["card", "table", "profile", "chart", "text", "custom"])
      expect(src).toContain(`'${v}'`);
  });
  it("sub-componenti Bone, CardSkeleton, TableSkeleton, ProfileSkeleton, ChartSkeleton", () => {
    expect(src).toContain("function Bone");
    expect(src).toContain("function CardSkeleton");
    expect(src).toContain("function TableSkeleton");
    expect(src).toContain("function ProfileSkeleton");
    expect(src).toContain("function ChartSkeleton");
  });
  it("skeleton-shimmer animazione + rows prop + rounded", () => {
    expect(src).toContain("skeleton-shimmer");
    expect(src).toContain("rows");
    expect(src).toContain("rounded");
  });
});

/* ── InfiniteScroll ── */
describe("InfiniteScroll", () => {
  const src = read("components/InfiniteScroll.tsx");
  it("export default InfiniteScroll + useInfiniteScroll hook + InfiniteScrollProps", () => {
    expect(src).toMatch(/export default function InfiniteScroll/);
    expect(src).toMatch(/export function useInfiniteScroll/);
    expect(src).toContain("export interface InfiniteScrollProps");
  });
  it("Spinner default + IntersectionObserver + sentinel + threshold 200px", () => {
    expect(src).toContain("function Spinner");
    expect(src).toContain("IntersectionObserver");
    expect(src).toContain("sentinelRef");
    expect(src).toContain("'200px'");
  });
  it("endMessage 'Nessun altro risultato' + hasMore + resetKey + loadingRef", () => {
    expect(src).toContain("Nessun altro risultato");
    expect(src).toContain("hasMore");
    expect(src).toContain("resetKey");
    expect(src).toContain("loadingRef");
  });
  it("useInfiniteScroll hook: pageRef + reset + loading state", () => {
    expect(src).toContain("pageRef");
    expect(src).toContain("const reset");
    expect(src).toContain("setLoading");
    expect(src).toContain("fetcher");
  });
});

/* ── FormField ── */
describe("FormField", () => {
  const src = read("app/components/FormField.tsx");
  it("export FormField + TextField + TextAreaField + SelectField", () => {
    expect(src).toMatch(/export function FormField\b/);
    expect(src).toMatch(/export function TextField\b/);
    expect(src).toMatch(/export function TextAreaField\b/);
    expect(src).toMatch(/export function SelectField\b/);
  });
  it("FieldValidator type + fieldInputStyle + FormFieldProps", () => {
    expect(src).toContain("export type FieldValidator");
    expect(src).toContain("export const fieldInputStyle");
    expect(src).toContain("export type FormFieldProps");
  });
  it("validators: required, minLength, email, url, compose", () => {
    expect(src).toContain("export const validators");
    for (const v of ["required", "minLength", "email", "url", "compose"])
      expect(src).toContain(`${v}:`);
    expect(src).toContain("Campo obbligatorio");
    expect(src).toContain("Email non valida");
    expect(src).toContain("URL non valido");
  });
  it("handleBlur + handleChange + useId + inlineError + asterisco required", () => {
    expect(src).toContain("handleBlur");
    expect(src).toContain("handleChange");
    expect(src).toContain("useId");
    expect(src).toContain("inlineError");
    expect(src).toContain("color: 'var(--color-red)'");
  });
});

/* ── EmptyState ── */
describe("EmptyState", () => {
  const src = read("app/components/EmptyState.tsx");
  it("export EmptyState + Props con icon/title/description/action/size", () => {
    expect(src).toMatch(/export function EmptyState/);
    expect(src).toContain("icon");
    expect(src).toContain("title");
    expect(src).toContain("description");
    expect(src).toContain("action");
  });
  it("3 size sm/md/lg con padding differenziato", () => {
    expect(src).toContain("'sm'");
    expect(src).toContain("'md'");
    expect(src).toContain("'lg'");
    expect(src).toContain("py-8");
    expect(src).toContain("py-14");
    expect(src).toContain("py-20");
  });
  it("action button con label + onClick + hover state", () => {
    expect(src).toContain("action.label");
    expect(src).toContain("action.onClick");
    expect(src).toContain("onMouseEnter");
    expect(src).toContain("onMouseLeave");
  });
});

/* ── VirtualList ── */
describe("VirtualList", () => {
  const src = read("components/VirtualList.tsx");
  it("export default VirtualList + useVirtualList hook + VirtualListProps", () => {
    expect(src).toMatch(/export default function VirtualList/);
    expect(src).toMatch(/export function useVirtualList/);
    expect(src).toContain("export interface VirtualListProps");
  });
  it("overscan + scrollToIndex + onEndReached + endReachedThreshold", () => {
    expect(src).toContain("overscan");
    expect(src).toContain("scrollToIndex");
    expect(src).toContain("onEndReached");
    expect(src).toContain("endReachedThreshold");
  });
  it("totalHeight + firstVisible/lastVisible + empty state 'Nessun elemento'", () => {
    expect(src).toContain("totalHeight");
    expect(src).toContain("firstVisible");
    expect(src).toContain("lastVisible");
    expect(src).toContain("Nessun elemento");
  });
});
