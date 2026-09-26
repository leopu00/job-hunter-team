import { supabaseConfigured } from "../../lib/supabase";

/**
 * Stand-in for web/lib/workspace.ts (which reads the filesystem): the desktop
 * has no local workspace database, so every query takes the Supabase branch.
 */
export const isSupabaseConfigured: boolean = supabaseConfigured;

export async function getWorkspacePath(): Promise<string | null> {
  return null;
}

export function workspaceHasDb(_path: string): boolean {
  return false;
}
