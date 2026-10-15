import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.DOKE_URL;
assert.ok(base, "Set DOKE_URL to the deployment URL to test.");
fs.mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  let errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const start = Date.now();
  await page.goto(base);
  await page.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 90000 },
  );
  const readyMs = Date.now() - start;
  assert.match(
    await page.locator("#render-stats").textContent(),
    /Gl|BrowserWebGpu/,
  );
  await page.locator('.explorer-dock [data-tab="activities"]').click();
  await page.locator('.activity-card[data-activity="music"]').click();
  await page.locator("#play").click();
  await page.waitForTimeout(1000);
  await page.locator("#play").click();
  await page.locator("#playhead").fill("36");
  await page.screenshot({ path: "test-results/09-deployed.png" });
  assert.equal(await page.locator("#share-global, #share").count(), 0);
  assert.equal(await page.title(), "doke");
  for (const scene of ["synapse", "circuit"]) {
    await page.locator(`#scene-navigation [data-scene="${scene}"]`).click();
    await page.waitForTimeout(500);
  }
  await page.locator("#stimulate-circuit").click();
  await page.locator("#micro-info").click();
  await page.waitForTimeout(300);
  assert.ok(
    +(await page.locator("#model-readout").textContent()).match(
      /time ([\d.]+)/,
    )[1] > 0,
  );
  await page.locator('#scene-navigation [data-scene="synapse"]').click();
  await page.locator("#inspect-molecule").click();
  await page.locator('[data-molecule="glutamate"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("#micro-title").textContent === "L-glutamic acid",
  );
  await page.waitForTimeout(200);
  assert.match(
    await page.locator("#micro-description").textContent(),
    /conjugate acid/,
  );
  const release = await (await page.request.get(base + "/release.json")).json();
  assert.equal(release.version, "0.3.0");
  const native = await (
    await page.request.get(base + "/assets/native/manifest.json")
  ).json();
  assert.equal(native.triangles, 5080888);
  const health = await page.request.get(base + "/health");
  assert.equal(await health.text(), "doke ok\n");
  const wasm = await page.request.get(base + "/pkg/doke_bg.wasm");
  assert.match(wasm.headers()["content-type"], /application\/wasm/);
  const mesh = await page.request.get(base + "/assets/brain.bin", {
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(mesh.headers()["content-encoding"], "gzip");
  assert.deepEqual(errors, []);
  const resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => ({
      name: new URL(r.name).pathname,
      transferSize: r.transferSize,
      duration: r.duration,
    })),
  );
  const result = {
    base,
    readyMs,
    backend: await page.locator("#render-stats").textContent(),
    errors,
    resources,
    date: new Date().toISOString(),
  };
  fs.writeFileSync(
    "test-results/deployment-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
