/** Opt-in browser proof. Uses installed Playwright; never installs a browser or dependencies. */
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

async function writeAndIsolate(page) {
  return page.evaluate(async () => {
    const { PageDataDisk } = await import("/src/lib/page-data-disk.ts");
    const account = { accountFingerprint: "synthetic-account-a", teamFingerprint: "synthetic-team-a" };
    let identity = account;
    const disk = new PageDataDisk(async () => identity, () => 0, undefined, () => 1000);
    const key = JSON.stringify([0, "positions", "list", {}]);
    await disk.write(key, { data: [{ id: "synthetic-position", title: "Synthetic role" }], at: 900 });
    identity = { ...account, accountFingerprint: "synthetic-account-b" };
    const otherAccount = await disk.read(key);
    identity = { ...account, teamFingerprint: "synthetic-team-b" };
    const otherTeam = await disk.read(key);
    return { otherAccount, otherTeam };
  });
}

async function reopenAndBound(page) {
  return page.evaluate(async () => {
    const { PageDataDisk } = await import("/src/lib/page-data-disk.ts");
    const { PageDataStore } = await import("/src/lib/page-data-store.ts");
    const { IndexedPageCopies } = await import("/src/lib/page-data-indexeddb.ts");
    const identity = { accountFingerprint: "synthetic-account-a", teamFingerprint: "synthetic-team-a" };
    const disk = new PageDataDisk(async () => identity, () => 0, undefined, () => 1000);
    const store = new PageDataStore(() => undefined, () => 1000, disk);
    const key = store.key("positions", "list");
    const started = performance.now();
    const copy = await store.read(key, "positions", () => new Promise(() => undefined));
    const firstCopyMs = performance.now() - started;
    document.body.textContent = copy[0].title;
    // The real IndexedDB adapter evicts old projections within one write transaction.
    const storage = new IndexedPageCopies();
    for (let n = 0; n < 33; n++) await storage.put({ key: `entry-${n}`, at: n, text: "{}" });
    return { copy, firstCopyMs, fromDisk: store.snapshot(key, "positions").fromDisk,
      evicted: await storage.get("entry-0"), retained: await storage.get("entry-32") };
  });
}

async function verify() {
  const modulePath = process.argv[2];
  const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
  const server = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)),
    plugins: [{ name: "synthetic-page-data-document", configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== "/__page_data_proof.html") return next();
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>Synthetic page data proof</title><body></body>");
      });
    } }],
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { host: "127.0.0.1", port: 0, strictPort: true, preTransformRequests: false }, logLevel: "error" });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__page_data_proof.html`);
    assert.equal(await page.title(), "Synthetic page data proof");
    assert.deepEqual(await writeAndIsolate(page), { otherAccount: null, otherTeam: null });
    await page.reload();
    const result = await reopenAndBound(page);
    assert.deepEqual(result.copy, [{ id: "synthetic-position", title: "Synthetic role" }]);
    assert.equal(result.fromDisk, true);
    assert.ok(result.firstCopyMs < 200, `first saved copy took ${result.firstCopyMs} ms`);
    assert.equal(result.evicted, null);
    assert.equal(result.retained.key, "entry-32");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: "PASS", checks: 9, ...result }));
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

await verify();
