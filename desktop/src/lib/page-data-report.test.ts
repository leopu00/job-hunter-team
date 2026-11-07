import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("./state-stream", () => ({ onStreamHint: () => () => undefined }));
import { pageData } from "./page-data";

beforeEach(() => { pageData.reset(); native.invoke.mockReset(); });

it.each([false, "reject"])("a failed diagnostic write is visible for reply %s", async (reply) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  native.invoke.mockImplementation(() => reply === "reject" ? Promise.reject({ code: "synthetic" }) : Promise.resolve(reply));
  await pageData.revalidate(pageData.key("profile", "profile"), "profile", async () => { throw { code: "positions_unavailable" }; });
  await Promise.resolve();
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("page_data_failure", { kind: "refresh" });
  expect(error).toHaveBeenCalledExactlyOnceWith("runtime_log_failed: the data error could not be recorded");
  error.mockRestore();
});
