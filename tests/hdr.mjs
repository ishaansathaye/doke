import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const b = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  let errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      q === "(dynamic-range: high)"
        ? {
            ...original(q),
            matches: true,
            media: q,
            addEventListener() {},
            removeEventListener() {},
          }
        : original(q);
  });
  await p.goto("http://127.0.0.1:4173/");
  await p.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 60000 },
  );
  await p.waitForTimeout(800);
  const config = await p.evaluate(() => {
    const c = document
      .querySelector("#brain-canvas")
      .getContext("webgpu")
      .getConfiguration();
    return {
      format: c.format,
      toneMapping: c.toneMapping,
      textCanvas: !!document.querySelector("#hdr-text"),
      displayStatus: document.querySelector("#hdr-status").textContent,
    };
  });
  assert.equal(config.format, "rgba16float");
  assert.equal(config.toneMapping.mode, "extended");
  assert.equal(config.textCanvas, true);
  await p.screenshot({ path: "test-results/doke-hdr-pipeline.png" });
  await p.setViewportSize({ width: 1100, height: 800 });
  await p.waitForTimeout(200);
  assert.equal(
    await p.evaluate(
      () =>
        document
          .querySelector("#brain-canvas")
          .getContext("webgpu")
          .getConfiguration().toneMapping.mode,
    ),
    "extended",
  );
  await p.locator("#settings-button").click();
  await p.locator("#light-mode").selectOption("sdr");
  assert.equal(
    await p.evaluate(
      () =>
        document
          .querySelector("#brain-canvas")
          .getContext("webgpu")
          .getConfiguration().toneMapping.mode,
    ),
    "standard",
  );
  await p.setViewportSize({ width: 1200, height: 850 });
  await p.waitForTimeout(200);
  assert.equal(
    await p.evaluate(
      () =>
        document
          .querySelector("#brain-canvas")
          .getContext("webgpu")
          .getConfiguration().toneMapping.mode,
    ),
    "standard",
  );
  await p.locator("#light-mode").selectOption("auto");
  await p.locator("#settings-button").click();
  await p.locator('#scene-navigation [data-scene="synapse"]').click();
  await p.waitForTimeout(300);
  await p.locator("#micro-info").click();
  await p.locator("#details").evaluate((el) => (el.scrollTop = 300));
  await p.waitForTimeout(100);
  await p.locator("#close-panel").click();
  await p.locator('#scene-navigation [data-scene="molecule"]').click();
  await p.waitForFunction(
    () => document.querySelectorAll('.atom-label[data-element="O"]').length > 0,
  );
  assert.equal(
    await p.evaluate(
      () =>
        document
          .querySelector("#brain-canvas")
          .getContext("webgpu")
          .getConfiguration().toneMapping.mode,
    ),
    "extended",
  );
  await p.waitForTimeout(1000);
  await p.screenshot({ path: "test-results/v03-hdr-molecule.png" });
  assert.deepEqual(errors, []);
  const report = {
    status: "passed",
    ...config,
    errors,
    scope:
      "Capability signal emulated to exercise real rgba16float extended canvas, HDR text, resize and SDR switch. No photometric HDR-screen validation.",
  };
  fs.writeFileSync(
    "test-results/hdr-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await b.close();
}
