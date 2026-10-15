import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
fs.mkdirSync("test-results", { recursive: true });
const base = process.env.DOKE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const errors = [],
  external = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
function observe(p) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("ERR_FAILED"))
      errors.push(m.text());
  });
  p.on("request", (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith("data:"))
      external.push(r.url());
  });
}
async function ready(p) {
  await p.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 90000 },
  );
  await p.waitForTimeout(250);
}
const scene = (p, id) =>
  p.locator(`#scene-navigation [data-scene="${id}"]`).click();
const dock = (p, id) => p.locator(`.explorer-dock [data-tab="${id}"]`).click();
async function snap(p, name) {
  await p.waitForTimeout(850);
  await p.screenshot({ path: `test-results/${name}.png` });
}
try {
  const p = await context.newPage();
  observe(p);
  await p.goto(base);
  await ready(p);
  assert.equal(await p.title(), "doke");
  assert.match(
    await p.locator("#render-stats").textContent(),
    /BrowserWebGpu|Gl/,
  );
  assert.equal(await p.locator(".left-panel").isVisible(), false);
  assert.equal(await p.locator(".right-panel").isVisible(), false);
  await snap(p, "doke-home");
  await dock(p, "explore");
  assert.equal(await p.locator("#region-list button").count(), 36);
  await p.locator("#region-search").fill("thalamus");
  await p.locator('#region-list [data-region="thalamus"]').click();
  assert.match(await p.locator("#details").textContent(), /Thalamus/);
  assert.match(await p.locator("#scale-tag").textContent(), /Inside/);
  await p.locator('[data-focus="thalamus"]').click();
  if (await p.locator("#close-panel").isVisible())
    await p.locator("#close-panel").click();
  if (await p.locator("#close-panel").isVisible())
    await p.locator("#close-panel").click();
  await p.locator("#view-cut").click();
  assert.equal(await p.locator("#cut-control").isVisible(), true);
  await p.locator("#cut-depth").fill("0.2");
  await p.locator("#view-whole").click();
  await p.locator("#reset-view").click();
  for (const id of ["music", "reward", "vision", "movement"]) {
    await dock(p, "activities");
    await p.locator(`.activity-card[data-activity="${id}"]`).click();
    await p.locator('[data-chapter="2"]').click();
    assert.match(await p.locator("#details .pill").textContent(), /CHAPTER 3/);
    assert.ok(await p.locator("#details [data-source]").count());
  }
  await dock(p, "activities");
  await p.locator('.activity-card[data-activity="music"]').click();
  await p.locator("#play").click();
  await p.waitForTimeout(700);
  assert.ok(+(await p.locator("#playhead").inputValue()) > 0.3);
  await p.locator("#play").click();
  const paused = await p.locator("#playhead").inputValue();
  await p.waitForTimeout(150);
  assert.equal(await p.locator("#playhead").inputValue(), paused);
  await p.locator("#playhead").fill("36");
  await snap(p, "doke-activity");
  await p.locator('#details [data-source="music"]').click();
  assert.match(
    await p.locator("#details a.external").getAttribute("href"),
    /^https:/,
  );
  await p.locator("#close-tab").click();
  assert.equal(await p.locator("#share-global, #share").count(), 0);
  await p.locator("#details [data-synapse]").click();
  assert.equal(await p.locator("body").getAttribute("data-scene"), "synapse");
  for (let i = 0; i < 4; i++) {
    await p.locator(`#micro-steps [data-step="${i}"]`).click();
    assert.match(
      await p.locator("#micro-kicker").textContent(),
      new RegExp(`STEP ${i + 1}`),
    );
  }
  await p.locator('#micro-steps [data-step="2"]').click();
  assert.match(
    await p.locator("#micro-description").textContent(),
    /not ion-channel/,
  );
  await p.locator("#focus-cleft").click();
  assert.match(await p.locator("#focus-cleft").textContent(), /Whole synapse/);
  await snap(p, "doke-cleft-close");
  await p.locator("#focus-cleft").click();
  await p.locator("#reset-view").click();
  await snap(p, "doke-synapse");
  await p.locator("#inspect-molecule").click();
  await p.waitForFunction(
    () => document.querySelectorAll(".atom-label").length > 5,
  );
  assert.equal(await p.locator("body").getAttribute("data-scene"), "molecule");
  await snap(p, "doke-molecule");
  for (const id of ["glutamate", "gaba", "dopamine"]) {
    await p.locator(`[data-molecule="${id}"]`).click();
    await p.waitForTimeout(200);
    await p.locator("#micro-info").click();
    assert.match(await p.locator("#details").textContent(), /PUBCHEM/);
    if (await p.locator("#close-panel").isVisible())
      await p.locator("#close-panel").click();
  }
  await scene(p, "circuit");
  await p.locator("#stimulate-circuit").click();
  await p.waitForTimeout(400);
  await snap(p, "doke-circuit");
  await p.locator("#circuit-controls").click();
  await p.locator("#drive").fill("3.2");
  await p.locator("#inhibition").fill("9.1");
  if (await p.locator("#close-panel").isVisible())
    await p.locator("#close-panel").click();
  await p.locator("#circuit-source").click();
  assert.match(await p.locator("#details").textContent(), /Heun/);
  await p.locator("#close-tab").click();
  await p.locator("#micro-info").click();
  assert.ok(
    +(await p.locator("#model-readout").textContent()).match(
      /time ([\d.]+)/,
    )[1] > 0,
  );
  if (await p.locator("#close-panel").isVisible())
    await p.locator("#close-panel").click();
  await scene(p, "atlas");
  await p.locator("#settings-button").click();
  await p.locator("#quality").selectOption("fine");
  await p.waitForFunction(
    () => document.querySelector("#load-progress").hidden,
    null,
    { timeout: 180000 },
  );
  assert.match(await p.locator("#render-stats").textContent(), /2,1/);
  await p.route("**/assets/native/part-000.brnz", async (r) => {
    await new Promise((ok) => setTimeout(ok, 1000));
    await r.continue().catch(() => {});
  });
  await p.locator("#quality").selectOption("high");
  await p.locator("#cancel-detail").click();
  await p.waitForFunction(
    () => document.querySelector("#load-progress").hidden,
  );
  assert.match(await p.locator("#render-stats").textContent(), /2,1/);
  await p.unroute("**/assets/native/part-000.brnz");
  await p.locator("#quality").selectOption("high");
  await p.waitForFunction(
    () => document.querySelector("#load-progress").hidden,
    null,
    { timeout: 180000 },
  );
  assert.match(await p.locator("#render-stats").textContent(), /5,080,888/);
  await p.locator("#settings-button").click();
  await snap(p, "doke-native");
  await p.locator("#settings-button").click();
  await p.locator("#quality").selectOption("low");
  await p.waitForFunction(
    () => document.querySelector("#load-progress").hidden,
  );
  await p.locator("#settings-button").click();
  await p.locator("#about-button").click();
  assert.match(await p.locator("#details").textContent(), /CC BY 4.0/);
  await p.locator("#close-tab").click();
  const gl = await context.newPage();
  observe(gl);
  await gl.goto(base + "/?backend=webgl");
  await ready(gl);
  assert.match(await gl.locator("#render-stats").textContent(), /Gl/);
  for (const id of ["synapse", "circuit"]) {
    await scene(gl, id);
    await gl.waitForTimeout(200);
  }
  await snap(gl, "doke-webgl");
  await gl.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  observe(mobile);
  await mobile.goto(base);
  await ready(mobile);
  assert.equal(await mobile.locator("#reduced-motion").isChecked(), true);
  await snap(mobile, "doke-mobile");
  for (const id of ["synapse", "circuit"]) {
    await scene(mobile, id);
    await snap(mobile, "doke-mobile-" + id);
  }
  await scene(mobile, "atlas");
  await dock(mobile, "explore");
  await mobile.locator("#region-search").fill("caudate");
  await mobile.locator('#region-list [data-region="caudate"]').click();
  assert.equal(await mobile.locator("body").getAttribute("data-info"), "open");
  assert.equal(
    await mobile.locator("body").getAttribute("data-explorer"),
    "closed",
  );
  await snap(mobile, "doke-mobile-info");
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mobile.close();
  const fallback = await context.newPage();
  await fallback.route("**/pkg/doke.js", (r) => r.abort());
  await fallback.goto(base);
  await ready(fallback);
  assert.match(
    await fallback.locator("#render-stats").textContent(),
    /unavailable/,
  );
  await dock(fallback, "explore");
  await fallback.locator("#region-search").fill("caudate");
  await fallback.locator('#region-list [data-region="caudate"]').click();
  assert.match(await fallback.locator("#details").textContent(), /Caudate/);
  await fallback.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const report = {
    status: "passed",
    base,
    date: new Date().toISOString(),
    errors,
    externalRequests: external,
    checks: [
      "floating contextual drawers",
      "36 regions and deep focus",
      "cutaway",
      "four activity chapters and playback",
      "sources",
      "source tabs and share controls removed",
      "four 3D synapse stages",
      "three PubChem structures",
      "Rust network stimulation and controls",
      "fine/native mesh and cancellation",
      "WebGL scenes",
      "390px touch and reduced motion",
      "missing-WASM text fallback",
    ],
  };
  fs.writeFileSync(
    "test-results/browser-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await browser.close();
}
