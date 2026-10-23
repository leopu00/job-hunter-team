import { invoke, isTauri } from "@tauri-apps/api/core";

/** A saved connection declaration contains a key location, never private-key bytes. */
export interface SavedVps {
  id: string;
  name: string;
  address: string;
  user: string;
  port: number;
  keyPath: string;
  fingerprint?: string;
  teamId?: string;
  container?: string;
}

export type SavedVpsAdd = Omit<SavedVps, "id">;

function desktopOnly(): never { throw { code: "desktop_only" }; }

export const savedVpsBridge = {
  list: (): Promise<SavedVps[]> => isTauri() ? invoke("saved_vps_list") : Promise.resolve([]),
  add: (input: SavedVpsAdd): Promise<SavedVps> => isTauri() ? invoke("saved_vps_add", { input }) : desktopOnly(),
  rename: (id: string, name: string): Promise<SavedVps> => isTauri()
    ? invoke("saved_vps_rename", { input: { id, name } }) : desktopOnly(),
  remove: (id: string): Promise<void> => isTauri() ? invoke("saved_vps_remove", { id }) : desktopOnly(),
};
