import { existsSync } from "node:fs";

export function isContainer() {
  if (process.env.IS_CONTAINER === "1") return true;
  try {
    return existsSync("/.dockerenv");
  } catch {
    return false;
  }
}
