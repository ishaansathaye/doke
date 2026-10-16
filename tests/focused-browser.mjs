/** Real-browser focused explorer checks. Brain geometry requires generated assets;
 * DOKE_SKIP_BRAIN=1 skips those assertions but still tests its unavailable state. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.DOKE_URL || "http://127.0.0.1:4181";
const isMac = process.platform === "darwin";
const backend = process.env.DOKE_BACKEND || (isMac ? "webgpu" : "webgl");
const skipBrain = process.env.DOKE_SKIP_BRAIN === "1";
const artifactPrefix = `focused-${backend}${skipBrain ? "-no-atlas" : ""}`;
const app = new URL(base);
app.searchParams.set("backend", backend);
const output = "test-results";
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [],
  requests = [],
  skipped = [];
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    process.env.CHROME_PATH ||
    (isMac
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined),
  headless: true,
  args: isMac
    ? ["--enable-unsafe-webgpu", "--use-angle=metal"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const snapshot = (page) => page.evaluate(() => window.dokeFocused.snapshot());
const state = (page) => page.evaluate(() => window.dokeFocused.getState());
const brainState = (page) =>
  page.evaluate(() => window.dokeBrainComparison.snapshot());
const finish = (page) => page.evaluate(() => window.dokeFocused.finish());
const shot = (page, name) =>
  page.screenshot({ path: `${output}/${artifactPrefix}-${name}.png` });
async function closePanel(page) {
  if (await page.locator("#reader").isVisible())
    await page.locator("#reader-close").click();
}
async function ready(page, url = app.href, missingAtlas = false) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const intentional =
      missingAtlas &&
      /\/assets\/(atlas\.json|brain\.bin)$/.test(response.url());
    if (
      response.status() >= 400 &&
      !intentional &&
      !response.url().endsWith("/assets/fine/part-000.brnz")
    )
      requests.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    if (!request.failure()?.errorText.includes("ERR_ABORTED"))
      requests.push(`${request.failure()?.errorText} ${request.url()}`);
  });
  if (missingAtlas) {
    for (const path of ["atlas.json", "brain.bin"])
      await page.route(`**/assets/${path}`, (route) =>
        route.fulfill({ status: 503, body: "Intentionally unavailable atlas" }),
      );
  }
  await page.goto(url);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.ready === "true" &&
      window.dokeFocused?.snapshot(),
    null,
    { timeout: 90000 },
  );
  assert.equal(await page.title(), "doke");
  assert.equal(
    (await state(page)).rendererReady,
    true,
    "3D must initialize; a numerical-only fallback is insufficient",
  );
  const requested = new URL(url).searchParams.get("backend");
  assert.match(
    await page.evaluate(() => window.dokeFocused.getRenderer().backend()),
    requested === "webgl" ? /\bGl\b/ : /BrowserWebGpu/,
  );
}
function reference(a, b) {
  const c = Array(64).fill(0);
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      for (let k = 0; k < 8; k++)
        c[row * 8 + col] += a[row * 8 + k] * b[k * 8 + col];
  return c;
}
function complete(s) {
  assert.equal(s.status, "complete");
  assert.ok(s.valid.every(Boolean));
  assert.deepEqual(s.output, reference(s.input, s.weights));
  assert.equal(s.counters.macs, 512);
  assert.equal(s.counters.completed_outputs, 64);
  for (const output of s.detail.outputs) {
    assert.equal(output.terms.length, 8);
    assert.equal(output.retired_terms, 8);
    assert.equal(output.stored, true);
    let sum = 0;
    for (const term of output.terms) {
      // Rust's signed integers have one zero; JS multiplication can yield -0.
      assert.equal(term.product, term.a * term.b || 0);
      sum += term.product;
      assert.equal(term.sum_after, sum);
    }
    assert.equal(output.accumulated_sum, sum);
    assert.equal(output.reference_sum, sum);
  }
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    "No horizontal document overflow",
  );
}
async function visiblePanelBounds(page) {
  const box = await page.locator("#reader").boundingBox();
  const viewport = page.viewportSize();
  assert.ok(
    box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    "Floating panel stays inside viewport",
  );
}
async function savedOverview(page, prefix, count) {
  await page.locator("#explain").click();
  const savedKey = await page
    .locator('#reader-tabs [aria-selected="true"]')
    .getAttribute("data-tab");
  const original = await page
    .locator("#inspection [data-inspect]")
    .evaluateAll((items) => items.map((item) => item.dataset.inspect));
  assert.equal(original.filter((key) => key.startsWith(prefix)).length, count);
  await page.locator('[data-level="core"]').click();
  await page.locator("#explain").click();
  await page.locator(`#reader-tabs [data-tab="${savedKey}"]`).click();
  assert.deepEqual(
    await page
      .locator("#inspection [data-inspect]")
      .evaluateAll((items) => items.map((item) => item.dataset.inspect)),
    original,
    "A saved processor tab retains its processor components after entering a core",
  );
  await page.locator("#inspection details summary").click();
  await page.locator(`#inspection [data-inspect="${prefix}0"]`).click();
  assert.equal(
    (await state(page)).level,
    "processor",
    "A saved component link restores the level it belongs to",
  );
  assert.match(
    await page.locator("#inspection h2").textContent(),
    prefix === "sm-" ? /^SM 1$/ : /^Core 1$/,
  );
  await closePanel(page);
  await page.locator('[data-level="core"]').click();
}
async function enterBrain(page, missing = false) {
  await page.locator('[data-world="brain"]').click();
  await page.waitForFunction(
    () =>
      window.dokeBrainComparison &&
      (window.dokeBrainComparison.snapshot().ready ||
        window.dokeBrainComparison.snapshot().error),
    null,
    { timeout: 90000 },
  );
  assert.equal((await state(page)).world, "brain");
  if (missing) {
    assert.equal((await brainState(page)).ready, false);
    assert.equal(await page.locator("#brain-loading").isVisible(), true);
    assert.match(
      await page.locator("#brain-loading").textContent(),
      /unavailable/i,
    );
  } else {
    assert.equal((await brainState(page)).ready, true);
    assert.equal(await page.locator("#brain-loading").isHidden(), true);
    assert.equal(
      await page.evaluate(() =>
        window.dokeBrainComparison.getRenderer().triangle_count(),
      ),
      270212,
    );
  }
}
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await ready(page, app.href, skipBrain);
  assert.equal((await state(page)).world, "gpu");
  assert.equal((await state(page)).level, "processor");
  assert.equal(
    await page.evaluate(
      () =>
        window.dokeFocused
          .layout()
          .blocks.filter((b) => b.key.startsWith("sm-")).length,
    ),
    170,
  );
  await shot(page, "gpu-processor");

  const cameraBeforePan = await page.evaluate(() => [
    ...window.dokeFocused.getRenderer().camera_state(),
  ]);
  await page.keyboard.down("Shift");
  await page.mouse.move(900, 550);
  await page.mouse.down();
  await page.mouse.move(945, 575, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const cameraAfterPan = await page.evaluate(() => [
    ...window.dokeFocused.getRenderer().camera_state(),
  ]);
  assert.notDeepEqual(
    cameraAfterPan.slice(3),
    cameraBeforePan.slice(3),
    "Shift-drag pans the camera target",
  );
  assert.deepEqual(
    cameraAfterPan.slice(0, 3),
    cameraBeforePan.slice(0, 3),
    "Pan preserves distance and orbit angles",
  );
  await page.locator("#reset-camera").click();
  await page.locator("#settings-toggle").click();
  for (const clarity of ["balanced", "ultra", "sharp"]) {
    await page.locator("#resolution").selectOption(clarity);
    const resolution = await page.evaluate(() => ({
      width: document.querySelector("#chip-canvas").width,
      text: document.querySelector("#render-status").textContent,
    }));
    const reported = resolution.text.match(/([\d,]+) px/);
    assert.ok(reported);
    assert.equal(
      Number(reported[1].replaceAll(",", "")),
      resolution.width,
      "Resolution status reports the actual canvas width",
    );
  }
  await page.locator("#settings-toggle").click();
  checks.push(
    "Shift-drag changes the camera target and every clarity mode reports actual pixel width",
  );

  // Real picking exercises detailed geometry and IDs above the old 64 limit.
  const hit = await page.evaluate(() => {
    const r = window.dokeFocused.getRenderer(),
      layout = window.dokeFocused.layout(),
      canvas = document.querySelector("#chip-canvas"),
      rect = canvas.getBoundingClientRect();
    for (const block of layout.blocks
      .filter((b) => b.key.startsWith("sm-") && b.region > 64)
      .reverse()) {
      const p = r.project(
        block.position[0],
        block.position[1] + block.size[1] / 2 + 0.025,
        block.position[2],
      );
      const x = rect.x + (p[0] / canvas.width) * rect.width,
        y = rect.y + (p[1] / canvas.height) * rect.height;
      if (
        document.elementFromPoint(x, y) === canvas &&
        r.pick(p[0] / canvas.width, p[1] / canvas.height) === block.region
      )
        return { x, y, key: block.key, unit: block.unit };
    }
    return null;
  });
  assert.ok(hit, "A high-index SM is visible and pickable");
  await page.mouse.click(hit.x, hit.y);
  await page.locator('#inspection [data-enter="core"]').click();
  assert.equal((await state(page)).level, "core");
  assert.equal((await state(page)).selectedUnit, hit.unit);
  assert.equal(
    await page.evaluate(
      () =>
        window.dokeFocused
          .layout()
          .blocks.filter((b) => b.key.startsWith("scheduler-")).length,
    ),
    4,
  );
  await shot(page, "gpu-sm");
  await page.locator('[data-level="execution"]').click();
  assert.equal((await state(page)).level, "execution");
  assert.equal(
    await page.evaluate(
      () =>
        window.dokeFocused
          .layout()
          .blocks.filter((b) => b.key.startsWith("lane")).length,
    ),
    32,
  );
  await page.locator('[data-level="processor"]').click();
  await page.locator("#settings-toggle").click();
  await page.locator("#profile").selectOption("h100-sxm");
  await page.locator("#settings-toggle").click();
  assert.equal(
    await page.evaluate(
      () =>
        window.dokeFocused
          .layout()
          .blocks.filter((b) => b.key.startsWith("sm-")).length,
    ),
    132,
  );
  assert.match(await page.locator("#scene-title").textContent(), /H100/);
  await shot(page, "h100-processor");
  await savedOverview(page, "sm-", 132);
  await page.locator('[data-world="cpu"]').click();
  assert.equal(
    await page.evaluate(
      () =>
        window.dokeFocused
          .layout()
          .blocks.filter((b) => b.key.startsWith("core-")).length,
    ),
    16,
  );
  assert.match(await page.locator("#scene-title").textContent(), /9950X/);
  await shot(page, "cpu-processor");
  await savedOverview(page, "core-", 16);
  assert.ok(
    await page.evaluate(() =>
      window.dokeFocused.layout().blocks.some((b) => b.key === "branch"),
    ),
  );
  await shot(page, "cpu-core");
  await page.locator('[data-level="execution"]').click();
  checks.push(
    "Three reference profiles, processor/core/execution levels, and real high-index SM picking",
  );
  checks.push(
    "Saved GPU/CPU processor tabs retain their component lists and restore the correct scene",
  );

  await page.locator("#reset").click();
  await page.evaluate(() => window.dokeFocused.pin(0));
  await page.locator("#run").click();
  assert.ok((await snapshot(page)).tick > 0, "Play executes immediately");
  await page.locator("#inspection").focus();
  await page.waitForFunction(() => {
    const match = document
      .querySelector("#inspection .eyebrow")
      ?.textContent.match(/TICK (\d+)/);
    return match && Number(match[1]) >= 5;
  });
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "inspection",
  );
  await page.locator("#run").click();
  assert.equal((await state(page)).playing, false);
  const paused = await snapshot(page);
  const panelTick = (
    await page.locator("#inspection .eyebrow").textContent()
  ).match(/TICK (\d+)/);
  assert.ok(panelTick);
  assert.equal(
    Number(panelTick[1]),
    paused.tick,
    "Pausing refreshes the focused live panel to the current model tick",
  );
  await page.waitForTimeout(250);
  assert.deepEqual(
    await snapshot(page),
    paused,
    "Pause freezes the whole numerical state",
  );
  await page.locator("#step").click();
  assert.equal((await snapshot(page)).tick, paused.tick + 1);
  await page.locator("#reset").click();
  assert.equal((await snapshot(page)).tick, 0);
  assert.equal((await snapshot(page)).counters.completed_outputs, 0);
  checks.push("Immediate play, stable pause, exact single-step and reset");
  await closePanel(page);

  await page.locator("#input-toggle").click();
  await page.locator("#input-preset").selectOption("clear");
  const tile = page.locator("#input-tile"),
    tileBox = await tile.boundingBox();
  assert.ok(tileBox);
  await tile.click({
    position: { x: tileBox.width / 16, y: tileBox.height / 16 },
  });
  const drawn = (await snapshot(page)).input;
  assert.equal(drawn[0], 7);
  await tile.focus();
  await tile.press("ArrowRight");
  await tile.press("Space");
  const edited = await finish(page);
  complete(edited);
  assert.notDeepEqual(edited.input, drawn);
  assert.ok(
    edited.output.some((v) => v !== 0),
    "Editing input changes the computed answer",
  );
  await page.locator("#input-preset").selectOption("checker");
  await page.locator("#cache-enabled").check();
  const cached = await finish(page);
  complete(cached);
  await page.locator("#cache-enabled").uncheck();
  const uncached = await finish(page);
  complete(uncached);
  assert.deepEqual(uncached.output, cached.output);
  assert.equal(uncached.counters.cache_hits, 0);
  assert.ok(cached.counters.cache_hits > 0);
  assert.ok(
    cached.tick < uncached.tick,
    "The model cache changes scheduling cost, not the answer",
  );
  await closePanel(page);
  await page.evaluate(() => window.dokeFocused.pin(0));
  assert.equal(
    await page
      .locator('#inspection table[aria-label="Completed products"] tbody tr')
      .count(),
    8,
  );
  assert.ok(
    !(await page.locator("#inspection").textContent()).includes(
      "not completed",
    ),
  );
  assert.equal(
    Number(await page.locator("#inspection .term-value").textContent()),
    uncached.output[0],
  );
  await shot(page, "cpu-value");
  await closePanel(page);
  await page.locator('[data-world="gpu"]').click();
  await page.locator('[data-level="execution"]').click();
  await page.locator("#input-toggle").click();
  await page.locator("#input-preset").selectOption("checker");
  await page.locator("#memory-layout").selectOption("packed");
  const contiguous = await finish(page);
  complete(contiguous);
  await page.locator("#memory-layout").selectOption("strided");
  const strided = await finish(page);
  complete(strided);
  assert.deepEqual(contiguous.output, cached.output);
  assert.deepEqual(strided.output, contiguous.output);
  assert.ok(strided.counters.sectors > contiguous.counters.sectors);
  checks.push(
    "Pointer/keyboard input and exact CPU/GPU products; cache/layout alter costs without changing values",
  );

  await closePanel(page);
  await page.locator("#explain").click();
  const key = await page
    .locator('#reader-tabs [aria-selected="true"]')
    .getAttribute("data-tab");
  const title = await page.locator("#inspection h2").textContent();
  await page.locator("#inspection [data-source]").first().click();
  assert.ok(await page.locator('#inspection a[href^="https://"]').count());
  await page.locator(`#reader-tabs [data-tab="${key}"]`).click();
  assert.equal(await page.locator("#inspection h2").textContent(), title);
  await page.evaluate(() => window.dokeFocused.pin(7));
  await page.locator("#reset").click();
  assert.equal(
    Number(await page.locator("#inspection .term-value").textContent()),
    0,
  );
  await finish(page);
  assert.equal(
    Number(await page.locator("#inspection .term-value").textContent()),
    (await snapshot(page)).output[7],
  );
  await shot(page, "gpu-value");
  await closePanel(page);
  checks.push(
    "Source tabs restore context and pinned output panels follow actual completed arithmetic",
  );

  await enterBrain(page, skipBrain);
  if (!skipBrain) {
    await shot(page, "brain-resting");
    await page.locator("#anatomy").click();
    await page.locator("#region-search").fill("thalamus");
    await page.locator('[data-region="thalamus"]').click();
    assert.equal((await brainState(page)).selectedRegion, "thalamus");
    assert.match(
      await page.locator("#inspection h2").textContent(),
      /Thalamus/,
    );
    await closePanel(page);
    await page.locator("#brain-cutaway").click();
    await page.locator('[data-cutaway="deep"]').click();
    assert.equal((await brainState(page)).cutaway, "deep");
    await page.locator("#reset-camera").click();
    assert.equal((await brainState(page)).cutaway, "whole");
    await page.locator("#brain-vision").click();
    const hardwareBefore = await snapshot(page);
    await page.locator("#brain-guide-play").click();
    await page.waitForFunction(
      () => window.dokeBrainComparison.snapshot().time > 0.1,
    );
    await page.locator("#brain-guide-play").click();
    const brainPaused = await brainState(page);
    await page.waitForTimeout(150);
    assert.deepEqual(await brainState(page), brainPaused);
    await page.locator("#brain-guide-next").click();
    assert.equal((await brainState(page)).stageIndex, 1);
    assert.deepEqual(await snapshot(page), hardwareBefore);
    await page.locator("#brain-guide-play").click();
    await page.waitForFunction(
      () => window.dokeBrainComparison.snapshot().time > 4.1,
    );
    await page.locator('[data-world="gpu"]').click();
    const hiddenGuide = await brainState(page);
    assert.equal(
      hiddenGuide.playing,
      false,
      "Leaving the visible guide pauses its clock",
    );
    await page.waitForTimeout(180);
    assert.equal((await brainState(page)).time, hiddenGuide.time);
    await page.locator('[data-world="brain"]').click();
    await page.locator("#brain-guide-play").click();
    await page.waitForFunction(
      (time) => window.dokeBrainComparison.snapshot().time > time + 0.1,
      hiddenGuide.time,
    );
    await page.locator("#brain-guide-play").click();
    assert.equal((await brainState(page)).playing, false);
    assert.deepEqual(
      await snapshot(page),
      hardwareBefore,
      "Returning to the guide does not execute hardware",
    );
    await page.locator("#brain-guide-evidence").click();
    assert.ok(await page.locator("#inspection [data-source]").count());
    await closePanel(page);
    await shot(page, "brain");
    await page.route("**/assets/fine/part-000.brnz", (route) =>
      route.fulfill({ status: 503, body: "Intentional chunk failure" }),
    );
    await page.locator("#settings-toggle").click();
    await page.locator("#brain-quality").selectOption("fine");
    await page.waitForFunction(
      () => !!window.dokeBrainComparison.snapshot().qualityError,
    );
    assert.equal((await brainState(page)).quality, "overview");
    assert.equal(await page.locator("#brain-quality").inputValue(), "overview");
    assert.equal(
      await page.evaluate(() =>
        window.dokeBrainComparison.getRenderer().triangle_count(),
      ),
      270212,
    );
    await page.unroute("**/assets/fine/part-000.brnz");
    await page.locator("#resolution").selectOption("ultra");
    const clarity = await brainState(page);
    assert.ok(
      clarity.pixelWidth <= 4096 &&
        clarity.pixelHeight <= 4096 &&
        clarity.pixelWidth * clarity.pixelHeight <= 12000000,
    );
    await page.waitForFunction(() => {
      const reported = document
        .querySelector("#render-status")
        .textContent.match(/([\d,]+) px/);
      return (
        reported &&
        Number(reported[1].replaceAll(",", "")) ===
          document.querySelector("#brain-canvas").width
      );
    });
    await page.locator("#settings-toggle").click();
    checks.push(
      "Real brain anatomy, cutaway, independent guide, evidence and failed-quality recovery",
    );
  } else {
    skipped.push(
      "Generated brain geometry, anatomical picking, guide rendering and chunk-recovery checks (DOKE_SKIP_BRAIN=1)",
    );
    checks.push("Unavailable atlas retains a visible explanation");
  }
  await page.locator('[data-world="gpu"]').click();
  await page.locator("#compare-toggle").click();
  assert.equal((await state(page)).comparing, true);
  assert.equal(await page.locator("#brain-canvas").isVisible(), true);
  assert.equal(await page.locator("#chip-canvas").isVisible(), true);
  await noOverflow(page);
  await shot(page, "compare");
  checks.push("Desktop comparison shows two independent surfaces");

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  await ready(mobile, app.href, skipBrain);
  await noOverflow(mobile);
  const quiet = await snapshot(mobile);
  await mobile.waitForTimeout(200);
  assert.deepEqual(await snapshot(mobile), quiet);
  const touchCameraBefore = await mobile.evaluate(() => [
    ...window.dokeFocused.getRenderer().camera_state(),
  ]);
  const touchSession = await mobile.context().newCDPSession(mobile);
  const touches = (a, b, y) => [
    { x: a, y, id: 1 },
    { x: b, y, id: 2 },
  ];
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touches(130, 250, 500),
  });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: touches(125, 255, 500),
  });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: touches(105, 275, 510),
  });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const touchCameraAfter = await mobile.evaluate(() => [
    ...window.dokeFocused.getRenderer().camera_state(),
  ]);
  assert.ok(
    touchCameraAfter[0] < touchCameraBefore[0],
    "Spreading two fingers zooms into the processor",
  );
  assert.notDeepEqual(
    touchCameraAfter.slice(3),
    touchCameraBefore.slice(3),
    "Moving two fingers pans the target",
  );
  await touchSession.detach();
  await mobile.locator("#reset-camera").tap();
  await mobile.locator('[data-level="execution"]').tap();
  await mobile.locator("#input-toggle").tap();
  await visiblePanelBounds(mobile);
  const mobileInput = (await snapshot(mobile)).input;
  const touch = await mobile.locator("#input-tile").boundingBox();
  await mobile.touchscreen.tap(
    touch.x + touch.width / 16,
    touch.y + touch.height / 16,
  );
  assert.notDeepEqual((await snapshot(mobile)).input, mobileInput);
  await shot(mobile, "mobile-input");
  await closePanel(mobile);
  await mobile.locator("#step").tap();
  assert.equal((await snapshot(mobile)).tick, 1);
  await noOverflow(mobile);
  await shot(mobile, "mobile-execution");
  await mobile.locator("#compare-toggle").tap();
  await mobile.locator('[data-comparison-view="brain"]').tap();
  await mobile.waitForFunction(
    () =>
      window.dokeBrainComparison &&
      (window.dokeBrainComparison.snapshot().ready ||
        window.dokeBrainComparison.snapshot().error),
    null,
    { timeout: 90000 },
  );
  assert.equal(await mobile.locator("#brain-canvas").isVisible(), true);
  assert.equal(await mobile.locator("#chip-canvas").isVisible(), false);
  if (!skipBrain) assert.equal((await brainState(mobile)).ready, true);
  await noOverflow(mobile);
  await shot(mobile, "mobile-compare");
  await mobile.locator('[data-comparison-view="chip"]').tap();
  assert.equal(await mobile.locator("#step").isVisible(), true);
  await mobile.close();
  checks.push(
    "390px touch input, reduced-motion start, floating panel bounds and mobile comparison navigation",
  );

  if (backend !== "webgl") {
    const gl = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    const glUrl = new URL(app);
    glUrl.searchParams.set("backend", "webgl");
    await ready(gl, glUrl.href, skipBrain);
    await gl.locator('[data-level="execution"]').click();
    complete(await finish(gl));
    await shot(gl, "webgl");
    await enterBrain(gl, skipBrain);
    if (!skipBrain) assert.match((await brainState(gl)).backend, /\bGl\b/);
    await gl.close();
    checks.push(
      "Strict WebGL renderer initialization, computation and brain fallback/rendering",
    );
  }
  assert.deepEqual(errors, [], "No uncaught browser errors");
  assert.deepEqual(requests, [], "No unexpected failed assets");
  const report = {
    status: "passed",
    url: app.href,
    backend,
    skipBrain,
    checks,
    skipped,
    errors,
    requests,
  };
  fs.writeFileSync(
    `${output}/${artifactPrefix}-results.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await shot(page, "failure").catch(() => {});
  fs.writeFileSync(
    `${output}/${artifactPrefix}-results.json`,
    JSON.stringify(
      {
        status: "failed",
        checks,
        skipped,
        errors,
        requests,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
