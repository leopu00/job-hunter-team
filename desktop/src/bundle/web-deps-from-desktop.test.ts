// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isWebSourceImporter } from "../../vite.config";

describe("web dependency resolution from the desktop install", () => {
  it.each<[string, string]>([
    ["D:\\a\\job-hunter-team\\web\\app\\map.tsx", "D:\\a\\job-hunter-team\\web\\"],
    ["D:/a/job-hunter-team/web/app/map.tsx", "D:\\a\\job-hunter-team\\web"],
    ["/work/job-hunter-team/web/app/map.tsx", "/work/job-hunter-team/web/"],
  ])("recognizes a web importer across platform separators", (importer, webDir) => {
    expect(isWebSourceImporter(importer, webDir)).toBe(true);
  });

  it.each<[string | undefined, string]>([
    [undefined, "D:\\a\\job-hunter-team\\web"],
    ["D:\\a\\job-hunter-team\\desktop\\src\\main.tsx", "D:\\a\\job-hunter-team\\web"],
    ["/work/job-hunter-team/web-copy/app/map.tsx", "/work/job-hunter-team/web"],
  ])("does not redirect dependencies from outside web", (importer, webDir) => {
    expect(isWebSourceImporter(importer, webDir)).toBe(false);
  });
});
