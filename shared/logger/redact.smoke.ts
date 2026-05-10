/**
 * Smoke test rapido per redact.ts. Eseguibile via:
 *   npx tsx shared/logger/redact.smoke.ts
 *
 * Non e' una test suite formale: verifica che i pattern principali
 * matchino e che oggetti annidati con campi sensibili vengano mascherati.
 */
import { redactString, redactObject } from "./redact.ts";

const cases: Array<{ input: string; mustContain?: string; mustMissing?: string }> = [
  { input: "Bearer abc12345xyzabc", mustContain: "[REDACTED]", mustMissing: "abc12345xyzabc" },
  { input: "eyJhbGc.eyJzdWI.signed_part_three", mustContain: "[REDACTED]" },
  { input: "sk-ant-1234567890abcdef1234", mustContain: "[REDACTED]", mustMissing: "1234567890abcdef" },
  { input: "jht_sync_abcdef1234567890ZYX", mustContain: "[REDACTED]" },
  { input: "api_key=verysecret", mustContain: "[REDACTED]" },
  { input: 'password: "hunter2hunter2"', mustContain: "[REDACTED]" },
  { input: "hash a1b2c3d4e5f6789012345678901234567890", mustContain: "[REDACTED]" },
  { input: "no secrets here", mustMissing: "[REDACTED]" },
];

let failed = 0;
for (const { input, mustContain, mustMissing } of cases) {
  const out = redactString(input);
  const okC = !mustContain || out.includes(mustContain);
  const okM = !mustMissing || !out.includes(mustMissing);
  const ok = okC && okM;
  if (!ok) failed++;
  console.log(`[${ok ? "ok " : "FAIL"}]`, JSON.stringify(input), "->", JSON.stringify(out));
}

const obj = {
  user: "alice",
  Authorization: "Bearer secrettoken1234567890abcde",
  api_key: "mykey1234",
  message: "see Bearer abcdefghij1234567890ZZZ inside",
  nested: { token: "innersec123456789012345678" },
};
const reduced = redactObject(obj);
const flat = JSON.stringify(reduced);
const objOk = !flat.includes("secrettoken") && !flat.includes("innersec") && !flat.includes("mykey1234") && !flat.includes("abcdefghij1234567890ZZZ");
console.log(`[${objOk ? "ok " : "FAIL"}] redactObject ->`, flat);
if (!objOk) failed++;

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
