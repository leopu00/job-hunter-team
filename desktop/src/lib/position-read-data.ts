import type { DesktopVpsPositionsWindow } from "./existing-team-positions";

/** The same DTO boundary is used for native replies and saved copies. */
export function positionArrayData<T>(data: unknown): T[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const items = (data as Record<string, unknown>).items;
  return Array.isArray(items) ? items as T[] : null;
}

export function positionWindowData(data: unknown): DesktopVpsPositionsWindow | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { items, total, scamSection } = data as Record<string, unknown>;
  const section = typeof scamSection === "number" && Number.isInteger(scamSection) && scamSection >= 0 ? { scamSection } : {};
  return Array.isArray(items) && typeof total === "number" && Number.isInteger(total) && total >= 0
    ? { items: items as DesktopVpsPositionsWindow["items"], total, ...section } : null;
}
