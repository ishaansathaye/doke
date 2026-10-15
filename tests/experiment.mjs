import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const base = process.env.DOKE_URL || "http://127.0.0.1:4173";
const out = "test-results/experiment";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const errors = [],
  results = [];
const action = (p, name) =>
  p.locator(`[data-experiment-action="${name}"]`).first();
const cue = (p, id) => p.locator(`[data-experiment-cue="${id}"]`);
const weight = async (p, id) =>
  +(await p.locator(`[data-cue-weight="${id}"]`).textContent());
const clock = (p) => p.locator("#experiment-clock").textContent();
const imageHash = async (p) =>
  crypto
    .createHash("sha256")
    .update(await p.locator("#brain-canvas").screenshot())
    .digest("hex");
async function idle(p) {
  await p.waitForFunction(
    () => !document.querySelector('[data-experiment-action="probe"]').disabled,
    null,
    { timeout: 30000 },
  );
}
async function ready(p, suffix = "?mode=experiment") {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto(`${base}/${suffix}`);
  await p.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 90000 },
  );
  await idle(p);
  assert.equal(
    await p.locator("body").getAttribute("data-scene"),
    "experiment",
  );
}
async function probe(p) {
  await action(p, "probe").click();
  await idle(p);
}
async function train(p) {
  await action(p, "train").click();
  await idle(p);
}

try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await ready(p);
  assert.match(await p.locator("#render-stats").textContent(), /BrowserWebGpu/);
  assert.equal(await p.locator("#timeline").isVisible(), false);
  assert.equal(await p.locator("#micro-controls").isVisible(), false);
  assert.equal(await weight(p, 0), 0.32);
  await p.screenshot({ path: `${out}/initial.png` });

  // Real controls, real elapsed playback: baseline → induction → frozen probe.
  await probe(p);
  assert.match(
    await p.locator('[data-cue-response="0"]').textContent(),
    /Below threshold|no spike/i,
  );
  assert.match(await p.locator("#experiment-status").textContent(), /-57\.0/);
  await action(p, "train").click();
  await p.waitForFunction(
    () => +document.querySelector('[data-cue-weight="0"]').textContent > 0.32,
  );
  await action(p, "pause").click();
  const paused = await clock(p),
    frozen = await imageHash(p);
  await p.waitForTimeout(350);
  assert.equal(await clock(p), paused);
  assert.equal(await imageHash(p), frozen, "paused GPU image changed");
  assert.equal(await cue(p, 1).isDisabled(), true);
  await p.screenshot({ path: `${out}/paused-pairing.png` });

  // A scene change preserves the paused trial and learning.
  const partialWeight = await weight(p, 0);
  await p.locator('#scene-navigation [data-scene="synapse"]').click();
  await p.waitForTimeout(200);
  await p.locator('#scene-navigation [data-scene="experiment"]').click();
  assert.equal(await clock(p), paused);
  assert.equal(await weight(p, 0), partialWeight);
  assert.match(await action(p, "pause").textContent(), /Resume/);
  await action(p, "pause").click();
  await idle(p);
  assert.ok((await weight(p, 0)) > 0.65);
  assert.equal(await weight(p, 1), 0.32);
  await probe(p);
  assert.match(
    await p.locator('[data-cue-response="0"]').textContent(),
    /Target fired|Last probe: fired/i,
  );
  assert.match(
    await p.locator("#experiment-status").textContent(),
    /no spike.*fired/i,
  );
  await p.screenshot({ path: `${out}/learned.png` });
  await cue(p, 1).click();
  await probe(p);
  assert.match(
    await p.locator('[data-cue-response="1"]').textContent(),
    /Below threshold|no spike/i,
  );
  assert.equal(await weight(p, 1), 0.32);

  // Evidence reuses the reader's tabs and does not discard learned state.
  await action(p, "evidence").click();
  await p.locator('#details [data-source="stdp-bi-poo"]').click();
  assert.match(
    await p.locator("#details").textContent(),
    /cultured rat hippocampal/i,
  );
  await p.locator('[data-panel-page="experiment"]').click();
  assert.match(
    await p.locator("#details").textContent(),
    /both spike times are imposed/i,
  );
  await p.screenshot({ path: `${out}/evidence.png` });
  await p.locator("#close-panel").click();
  assert.ok((await weight(p, 0)) > 0.65);

  await cue(p, 0).click();
  await p.locator("#experiment-order").selectOption("-1");
  await train(p);
  assert.ok((await weight(p, 0)) < 0.32);
  assert.match(await p.locator("#experiment-prompt").textContent(), /probe/i);
  // A prior successful probe is historical after weakening, not a current claim.
  assert.match(
    await p.locator('[data-cue-response="0"]').textContent(),
    /last probe|probe again/i,
  );
  await probe(p);
  assert.match(
    await p.locator('[data-cue-response="0"]').textContent(),
    /Below threshold|no spike/i,
  );

  // Cancel stops future events but keeps weight changes; Reset forgets all.
  await p.locator("#experiment-order").selectOption("1");
  await action(p, "train").click();
  await p.waitForTimeout(1600);
  await action(p, "cancel").click();
  const cancelledWeight = await weight(p, 0),
    cancelledTime = await clock(p);
  await p.waitForTimeout(300);
  assert.equal(await weight(p, 0), cancelledWeight);
  assert.equal(await clock(p), cancelledTime);
  await action(p, "reset").click();
  assert.equal(await weight(p, 0), 0.32);
  assert.match(
    await p.locator('[data-cue-response="0"]').textContent(),
    /Not probed/i,
  );

  // Wasm bridge must preserve the same event semantics under alternate batching.
  const wasmCheck = await p.evaluate(async () => {
    const { TimingExperiment } = await import("./pkg/doke.js");
    const a = new TimingExperiment(),
      b = new TimingExperiment();
    a.train(2, 10, 8);
    b.train(2, 10, 8);
    for (let i = 0; i < 8; i++) a.advance(250);
    for (let i = 0; i < 2000; i++) b.advance(1);
    const equal = a.snapshot() === b.snapshot();
    a.probe(2);
    a.advance(100);
    const after = JSON.parse(a.snapshot());
    a.free();
    b.free();
    return { equal, after };
  });
  assert.equal(wasmCheck.equal, true);
  assert.equal(wasmCheck.after.last_probe.spiked, true);
  results.push({
    backend: "WebGPU",
    flow: "baseline, pairing, pause, scene retention, control, source tabs, reverse pairing, cancel, reset",
    wasmBatching: true,
  });
  await p.close();

  const gl = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  await ready(gl, "?mode=experiment&backend=webgl");
  assert.match(await gl.locator("#render-stats").textContent(), /Gl/);
  await probe(gl);
  await train(gl);
  await probe(gl);
  assert.match(
    await gl.locator('[data-cue-response="0"]').textContent(),
    /Target fired|Last probe: fired/i,
  );
  await gl.screenshot({ path: `${out}/webgl.png` });
  results.push({ backend: "WebGL2", flow: "baseline, pairing, learned probe" });
  await gl.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
  });
  await ready(mobile);
  assert.equal(
    await mobile.locator("#pathway-experiment").getAttribute("data-reduced"),
    "true",
  );
  const initialTime = await clock(mobile);
  await mobile.waitForTimeout(250);
  assert.equal(await clock(mobile), initialTime);
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  for (const selector of [
    '[data-experiment-action="probe"]',
    "#experiment-order",
    '[data-experiment-cue="2"]',
  ]) {
    const box = await mobile.locator(selector).first().boundingBox();
    assert.ok(
      box &&
        box.x >= 0 &&
        box.x + box.width <= 390 &&
        box.y >= 0 &&
        box.y + box.height <= 844,
      `${selector} offscreen`,
    );
  }
  await cue(mobile, 2).focus();
  await mobile.keyboard.press("Enter");
  assert.equal(await cue(mobile, 2).getAttribute("aria-pressed"), "true");
  await action(mobile, "probe").focus();
  await mobile.keyboard.press("Enter");
  await idle(mobile);
  assert.match(
    await mobile.locator('[data-cue-response="2"]').textContent(),
    /Below threshold|no spike/i,
  );
  await mobile.screenshot({ path: `${out}/mobile-reduced.png` });
  await action(mobile, "evidence").click();
  assert.ok(await mobile.locator("#info-panel").isVisible());
  await mobile.locator("#settings-button").click();
  assert.equal(await mobile.locator("#info-panel").isVisible(), false);
  assert.ok(await mobile.locator("#view-settings").isVisible());
  await mobile.locator("#subtle-colors").uncheck();
  assert.equal(await mobile.locator("body").getAttribute("data-color"), "off");
  await mobile.locator("#settings-button").click();
  await mobile.screenshot({ path: `${out}/mobile-grayscale.png` });
  results.push({
    viewport: "390x844",
    reducedMotion: true,
    keyboard: true,
    grayscale: true,
    panelExclusion: true,
  });
  await mobile.close();
  // Compact layouts retain usable controls and keep the receiving cell clear
  // of the landscape dock, including a Retina-sized render target.
  for (const [width, height, dpr] of [
    [390, 700, 1],
    [844, 390, 1],
    [844, 390, 2],
  ]) {
    const compact = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: dpr,
      reducedMotion: "reduce",
    });
    await ready(compact);
    assert.equal(
      await compact.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    for (const selector of [
      '[data-experiment-action="probe"]',
      "#experiment-order",
      '[data-experiment-cue="2"]',
    ]) {
      const box = await compact.locator(selector).first().boundingBox();
      assert.ok(
        box &&
          box.x >= 0 &&
          box.x + box.width <= width &&
          box.y >= 0 &&
          box.y + box.height <= height,
        `${selector} outside ${width}x${height}`,
      );
    }
    if (width > height) {
      const target = await compact
        .locator('[data-experiment-cell="3"]')
        .boundingBox();
      const dock = await compact.locator(".experiment-dock").boundingBox();
      assert.ok(
        target &&
          target.x > 0 &&
          target.x + target.width < dock.x &&
          target.y + target.height < height - 50,
        "receiving cell label overlaps landscape controls",
      );
    }
    await compact.screenshot({
      path: `${out}/compact-${width}x${height}-${dpr}x.png`,
    });
    results.push({ viewport: `${width}x${height}`, dpr, controlsInView: true });
    await compact.close();
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/results.json`,
    JSON.stringify({ status: "passed", results, errors }, null, 2),
  );
  console.log(JSON.stringify({ status: "passed", results, errors }, null, 2));
} finally {
  await browser.close();
}
