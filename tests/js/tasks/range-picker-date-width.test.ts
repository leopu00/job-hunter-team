import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// The Team page's period picker: two date fields with no width of their own
// grow in WebKit (the desktop app's engine on macOS) to half the page each,
// and the presets end up alone on a line between them. Each field has its own
// width, so the presets, «from», «to» and the day count stay on one row.
const FILE = path.resolve(__dirname, "../../../web/app/(protected)/team/RangePicker.tsx");

it("gives both date fields a width of their own", () => {
  const source = readFileSync(FILE, "utf-8");
  const inputs = [...source.matchAll(/<input\s+type="date"[\s\S]*?className="([^"]*)"/g)].map((m) => m[1]);
  expect(inputs).toHaveLength(2);
  for (const classes of inputs) expect(classes.split(/\s+/)).toContain("w-40");
});
