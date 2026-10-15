import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const results = [];
const base = process.env.DOKE_URL || "http://127.0.0.1:4173";
try {
  for (const backend of ["webgpu", "webgl"]) {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + (backend === "webgl" ? "/?backend=webgl" : "/"));
    await p.waitForFunction(
      () => document.documentElement.dataset.ready === "true",
      null,
      { timeout: 90000 },
    );
    for (const scene of ["atlas", "tissue", "synapse", "circuit", "native"]) {
      if (scene === "tissue") await p.locator("#neuron-layer").click();
      else if (scene !== "native")
        await p.locator(`#scene-navigation [data-scene="${scene}"]`).click();
      else {
        await p.locator('#scene-navigation [data-scene="atlas"]').click();
        await p.locator("#settings-button").click();
        await p.locator("#quality").selectOption("high");
        await p.waitForFunction(
          () => document.querySelector("#load-progress").hidden,
          null,
          { timeout: 180000 },
        );
        await p.locator("#settings-button").click();
      }
      await p.waitForTimeout(1000);
      const frames = await p.evaluate(async () => {
        const arr = [];
        let prev = performance.now();
        for (let i = 0; i < 180; i++) {
          await new Promise(requestAnimationFrame);
          const now = performance.now();
          arr.push(now - prev);
          prev = now;
          document.querySelector("#brain-canvas").dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: i % 2 ? 0.05 : -0.05,
              cancelable: true,
            }),
          );
        }
        arr.sort((a, b) => a - b);
        return {
          medianMs: arr[90],
          p95Ms: arr[171],
          p99Ms: arr[178],
          frames: arr.length,
        };
      });
      results.push({
        backend,
        scene,
        ...frames,
        renderer: await p.locator("#render-stats").textContent(),
      });
      if (scene === "tissue") await p.locator("#neuron-layer").click();
    }
    assert.deepEqual(errors, []);
    await p.close();
  }
  const report = {
    date: new Date().toISOString(),
    viewport: "1440 × 1000, DPR 1",
    scope:
      "Headless Chrome on this Mac; animation-frame intervals during continuous rendering, not GPU timestamp queries or a guarantee on other devices.",
    results,
  };
  fs.writeFileSync(
    "test-results/performance-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await browser.close();
}
