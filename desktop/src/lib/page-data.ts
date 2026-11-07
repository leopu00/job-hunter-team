import { invoke, isTauri } from "@tauri-apps/api/core";
import { PageDataStore, type PageDataFailure } from "./page-data-store";
import { REFRESH_EVENT } from "../shell/refresh-event";
import { onStreamHint } from "./state-stream";
import { PageDataDisk } from "./page-data-disk";
import { pageDataIdentityReader } from "./page-data-persistence";

function report(error: PageDataFailure): void {
  if (!isTauri()) return;
  const kinds: Record<string, string> = { page_data_disk_read_failed: "disk_read",
    page_data_disk_write_failed: "disk_write", page_data_disk_invalid: "disk_invalid" };
  void invoke("page_data_failure", { kind: kinds[error.code] ?? "refresh" }).then((written) => {
    if (written !== true) console.error("runtime_log_failed: the data error could not be recorded");
  }).catch(() => {
    console.error("runtime_log_failed: the data error could not be recorded");
  });
}

export const pageData: PageDataStore = new PageDataStore(report, () => Date.now(),
  new PageDataDisk(pageDataIdentityReader, () => pageData.epoch()));
export const resetPageDataContext = pageData.reset;
export const suspendPageDataContext = pageData.suspend;

if (typeof window !== "undefined") {
  window.addEventListener(REFRESH_EVENT, () => pageData.invalidate());
  onStreamHint("profile", () => pageData.invalidate("profile"), 3000);
  onStreamHint("agents", () => pageData.invalidate("agents"), 3000);
  onStreamHint("positions", () => pageData.invalidate("positions"), 3000);
}
