import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const timeOwners = [
  "app/monitoring/page.tsx",
  "app/networking/page.tsx",
  "app/notifications/page.tsx",
  "app/queue/page.tsx",
  "app/reminders/page.tsx",
  "app/retry/page.tsx",
  "app/tasks/page.tsx",
  "components/InterviewCard.tsx",
];

for (const path of timeOwners) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /const\s+\[now\]\s*=\s*useState\(Date\.now\)/,
    `${path} must not freeze time at mount`,
  );
}

for (const path of timeOwners.slice(0, -1)) {
  assert.match(
    read(path),
    /\buseNow\((?:1000|60_000)\)/,
    `${path} must own one live clock for its list`,
  );
}
assert.match(
  read("components/InterviewCard.tsx"),
  /\bnow:\s*number\b/,
  "InterviewCard must receive its owner clock",
);
const clock = read("lib/use-now.ts");
assert.match(clock, /setInterval\(/, "The shared clock must keep time live");
assert.match(
  clock,
  /clearInterval\(/,
  "The shared clock must clean up its interval",
);

const spotlight = read("components/Spotlight.tsx");
for (const match of spotlight.matchAll(
  /setCurrentIdx\(\s*\w+\s*=>\s*\{([\s\S]*?)\}\s*\)/g,
)) {
  assert.doesNotMatch(
    match[1],
    /\bon(?:Finish|Skip)\s*\(/,
    "Spotlight state updater must stay pure",
  );
}
assert.doesNotMatch(
  spotlight,
  /queueMicrotask\(on(?:Finish|Skip)/,
  "Spotlight callbacks must be explicit",
);
assert.match(
  spotlight,
  /if \(e\.key === 'ArrowRight' \|\| e\.key === 'Enter'\) next\(\)/,
);
assert.match(spotlight, /if \(e\.key === 'ArrowLeft'\) prev\(\)/);
assert.match(spotlight, /if \(e\.key === 'Escape'\) skip\(\)/);

const cropper = read("components/Cropper.tsx");
const loadSection =
  cropper
    .split("/* ── Carica immagine ── */")[1]
    ?.split("/* ── Mouse interaction ── */")[0] ?? "";
assert.match(
  loadSection,
  /img\.onload\s*=\s*\(\)\s*=>\s*\{[\s\S]*setLoadedSrc\(src\)/,
  "Cropper must signal image readiness",
);
assert.match(
  loadSection,
  /img\.onload\s*=\s*null/,
  "Cropper must detach stale image handlers",
);
assert.match(
  loadSection,
  /\}, \[src\]\)/,
  "Cropper image loading must depend only on src",
);
assert.doesNotMatch(
  loadSection,
  /img\.onload\s*=\s*[^\n]*draw\(/,
  "Cropper onload must not close over draw",
);

for (const path of [
  "components/MultiSelect.tsx",
  "app/components/Select.tsx",
]) {
  const source = read(path);
  assert.match(
    source,
    /\buseId\(\)/,
    `${path} must allocate an instance-safe options id`,
  );
  assert.doesNotMatch(
    source,
    /(?:aria-controls|id)="(?:multi-)?select-options"/,
    `${path} must not use a static options id`,
  );
  assert.match(source, /aria-controls=\{optionsId\}/);
  assert.match(source, /id=\{optionsId\}/);
}

console.log("Payload lint regression contracts passed.");
