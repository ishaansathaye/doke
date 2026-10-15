import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
fs.mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const errors = [];
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(process.env.DOKE_URL || "http://127.0.0.1:4173");
  await p.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 90000 },
  );
  const tab = (key) => p.locator(`[data-panel-page="${key}"]`);
  assert.equal(await p.locator("#share, #share-global, dialog").count(), 0);
  assert.equal(await p.locator("#scene-mode").textContent(), "THE HUMAN BRAIN");
  await p.locator("#about-button").click();
  const about = await p.locator("#details").textContent();
  assert.match(about, /FOLLOW THE EVIDENCE/);
  assert.doesNotMatch(
    about,
    /Rust|WebAssembly|wgpu|hosting|Content 1\.1\.0|reviewed 2026|Dependency licenses|Anatomy notice|MVP/,
  );
  assert.match(about, /CC BY 4.0/);
  await p.locator('#details [data-source="allen"]').click();
  assert.equal(await tab("source-allen").getAttribute("aria-selected"), "true");
  assert.equal(await tab("about").count(), 1);
  await tab("about").click();
  const scroll = await p.locator("#details").evaluate((e) => e.scrollTop);
  assert.ok(scroll > 0, "About reading position restored");
  await p.locator('#details [data-source="allen"]').click();
  assert.equal(
    await tab("source-allen").count(),
    1,
    "Reuses existing source tab",
  );
  await p.locator("#close-tab").click();
  assert.equal(await tab("about").getAttribute("aria-selected"), "true");
  assert.ok(
    Math.abs(
      (await p.locator("#details").evaluate((e) => e.scrollTop)) - scroll,
    ) < 2,
  );
  await p.locator('#details [data-source="wilson"]').click();
  await p.locator('#panel-tabs [aria-selected="true"]').press("Home");
  assert.equal(
    await p.locator("#panel-browse").getAttribute("aria-selected"),
    "true",
  );
  await p.locator("#region-search").fill("thalamus");
  await p.locator('#region-list [data-region="thalamus"]').click();
  await p.locator("#panel-browse").click();
  await p.locator("#region-search").fill("hippocampus");
  await p.locator('#region-list [data-region="hippocampus"]').click();
  assert.equal(await tab("region-thalamus").count(), 1);
  await tab("region-thalamus").click();
  assert.match(await p.locator("#details h2").textContent(), /Thalamus/);
  await p.locator('#details [data-source="allen"]').click();
  await p.locator("#close-tab").click();
  assert.equal(
    await tab("region-thalamus").getAttribute("aria-selected"),
    "true",
  );
  await p.locator('#scene-navigation [data-scene="synapse"]').click();
  await p.locator("#micro-info").click();
  const synapseKey = await p
    .locator('#panel-tabs [aria-selected="true"]')
    .getAttribute("data-panel-page");
  await p.locator("#details [data-source]").first().click();
  const sourceKey = await p
    .locator('#panel-tabs [aria-selected="true"]')
    .getAttribute("data-panel-page");
  // Playback can change the live synapse explanation without replacing a source being read.
  await p.waitForTimeout(5400);
  assert.equal(
    await p
      .locator('#panel-tabs [aria-selected="true"]')
      .getAttribute("data-panel-page"),
    sourceKey,
  );
  await tab(synapseKey).click();
  assert.match(await p.locator("#details .pill").textContent(), /STEP/);
  await p.locator('#scene-navigation [data-scene="circuit"]').click();
  await p.locator("#circuit-source").click();
  await p.locator('#details [data-source="wilson"]').click();
  await p.locator("#close-tab").click();
  assert.equal(await tab("equations").getAttribute("aria-selected"), "true");
  await p.locator("#about-button").click();
  await p.locator("#details").evaluate((e) => (e.scrollTop = 0));
  await p.screenshot({ path: "test-results/panels-about-desktop.png" });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("#settings-button").click();
  assert.equal(await p.locator("#info-panel").isVisible(), false);
  await p.locator("#about-button").click();
  assert.equal(await p.locator("#view-settings").isVisible(), false);
  const box = await p.locator("#info-panel").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await p.locator('#details [data-source="allen"]').click();
  await tab("about").click();
  await p.locator("#details").evaluate((e) => (e.scrollTop = 0));
  await p.screenshot({ path: "test-results/panels-about-mobile.png" });
  await p.locator("#close-panel").click();
  await p.locator("#about-button").click();
  assert.equal(await tab("about").count(), 1);
  assert.deepEqual(errors, []);
  const report = {
    status: "passed",
    checks: [
      "science-only About",
      "sharing removed",
      "source return and deduplication",
      "reading position",
      "keyboard tabs",
      "multiple anatomy documents",
      "playback leaves source reading intact",
      "circuit source return",
      "mobile layout and tools exclusivity",
    ],
    errors,
  };
  fs.writeFileSync(
    "test-results/panels-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await browser.close();
}
