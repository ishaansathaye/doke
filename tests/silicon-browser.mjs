import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const base = process.env.DOKE_URL || "http://127.0.0.1:4181";
const isMac = process.platform === "darwin";
const outputDir = "test-results/silicon";
fs.mkdirSync(outputDir, { recursive: true });
const checks = [];
const errors = [];
const requests = [];
const appUrl = new URL(base);
if (!appUrl.pathname.endsWith("/silicon.html")) {
  appUrl.pathname = appUrl.pathname.replace(/\/$/, "") + "/silicon.html";
}
const backend = process.env.DOKE_BACKEND || (isMac ? "webgpu" : "webgl");
appUrl.searchParams.set("backend", backend);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (isMac
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined),
  headless: true,
  args: isMac
    ? ["--enable-unsafe-webgpu", "--use-angle=metal"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

function observe(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      requests.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    requests.push(`${request.failure()?.errorText} ${request.url()}`);
  });
}

async function ready(page, url = appUrl.href) {
  observe(page);
  await page.goto(url);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.ready === "true" &&
      typeof window.dokeSilicon?.snapshot === "function" &&
      typeof window.dokeSilicon?.finish === "function",
    null,
    { timeout: 90000 },
  );
  assert.equal(await page.title(), "doke");
  const requestedBackend = new URL(url).searchParams.get("backend");
  assert.match(
    await page.locator("#render-status").textContent(),
    requestedBackend === "webgl" ? /\bGl\b/ : /BrowserWebGpu/,
    `The requested 3D renderer initialized; numerical fallback alone is insufficient. Renderer details: ${await page.locator("#loading").textContent()}. Page errors: ${errors.join("; ")}`,
  );
}

const snapshot = (page) => page.evaluate(() => window.dokeSilicon.snapshot());

async function finish(page) {
  await page.evaluate(async () => {
    await window.dokeSilicon.finish();
  });
  return snapshot(page);
}

function multiply(a, b) {
  assert.equal(a.length, 64, "8×8 input matrix");
  assert.equal(b.length, 64, "8×8 filter matrix");
  const output = new Array(64).fill(0);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      for (let k = 0; k < 8; k++) {
        output[row * 8 + col] += a[row * 8 + k] * b[k * 8 + col];
      }
    }
  }
  return output;
}

function assertComplete(state, description) {
  assert.equal(state.status, "complete", description);
  assert.equal(state.valid.length, 64);
  assert.ok(state.valid.every(Boolean), "All output values have arrived");
  assert.equal(state.counters.completed_outputs, 64);
  assert.deepEqual(
    state.output,
    multiply(state.input, state.weights),
    description,
  );
}

function assertConserved(state) {
  assert.equal(state.conserved, true);
  assert.equal(
    state.attempted,
    state.dropped + state.delivered + state.occupied,
  );
  assert.equal(state.admitted, state.delivered + state.occupied);
  assert.equal(state.occupied, state.buffered + state.in_flight);
  assert.ok(state.occupied <= state.capacity_packets);
  assert.equal(state.packets.length, state.occupied);
  assert.equal(
    new Set(state.packets.map((packet) => packet.id)).size,
    state.occupied,
  );
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
}

async function assertNoOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    "No horizontal document overflow",
  );
}

async function inspectBlock(page, key) {
  const target = await page.evaluate(async (blockKey) => {
    const { makeLayout } = await import("./silicon-layouts.js");
    const block = makeLayout(window.dokeSilicon.family()).blocks.find(
      (item) => item.key === blockKey,
    );
    if (!block) throw new Error(`Unknown block: ${blockKey}`);
    const canvas = document.querySelector("#chip-canvas");
    const rect = canvas.getBoundingClientRect();
    const point = window.dokeSilicon
      .getRenderer()
      .project(
        block.position[0],
        block.position[1] + block.size[1] / 2,
        block.position[2],
      );
    return {
      x: rect.x + (point[0] / canvas.width) * rect.width,
      y: rect.y + (point[1] / canvas.height) * rect.height,
      depth: point[2],
      title: block.title,
    };
  }, key);
  assert.ok(target.depth > 0 && target.depth < 1);
  // Exercise the visible schematic's real hit test, not a test-only panel API.
  await page.mouse.click(target.x, target.y);
  await page
    .locator(`[data-panel="block:${key}"][aria-selected="true"]`)
    .waitFor();
  assert.equal(
    await page.locator("#inspection h2").textContent(),
    target.title,
  );
  return target.title;
}

let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await ready(page);
  await page.locator('[data-family="cpu"]').click();
  await page.locator("#reset").click();

  const profiles = await page.evaluate(async () => {
    const response = await fetch(new URL("hardware.json", location.href));
    if (!response.ok) throw new Error("Hardware catalog could not be loaded");
    return (await response.json()).profiles;
  });
  const profileIds = profiles.map((profile) => profile.id);
  const offeredIds = await page
    .locator("#chip-profile option")
    .evaluateAll((options) => options.map((option) => option.value));
  for (const id of offeredIds) assert.ok(profileIds.includes(id), id);
  assert.ok(
    offeredIds.length > 0,
    "The catalog provides selectable references",
  );
  const cpu = profiles.find((profile) => profile.family === "cpu");
  await page.locator("#chip-profile").selectOption(cpu.id);
  checks.push("Catalog-backed profile selection");

  const beforeStep = await snapshot(page);
  await page.locator("#step").click();
  assert.equal((await snapshot(page)).tick, beforeStep.tick + 1);
  await page.locator("#reset").click();
  const reset = await snapshot(page);
  assert.equal(reset.tick, 0);
  assert.equal(reset.counters.completed_outputs, 0);
  assert.ok(reset.valid.every((value) => !value));
  await page.locator("#run").click();
  await page.waitForFunction(() => window.dokeSilicon.snapshot().tick > 0);
  await page.locator("#run").click();
  const paused = await snapshot(page);
  await page.waitForTimeout(300);
  assert.deepEqual(await snapshot(page), paused, "Pause freezes model state");
  checks.push(
    "Pause freezes state; one step advances one tick; reset clears output",
  );

  await page.locator("#reset").click();
  const firstBlockTitle = await inspectBlock(page, "scheduler");
  await page.locator("#close-inspector").click();
  await inspectBlock(page, "compute");
  await page.locator('[data-panel="block:scheduler"]').click();
  for (let i = 0; i < 6; i++) {
    await page.locator("#step").click();
    const node = (await snapshot(page)).nodes.find(
      (item) => item.id === "scheduler",
    );
    assert.ok(node);
    assert.equal(
      await page.locator("#inspection h2").textContent(),
      firstBlockTitle,
      "Stepping refreshes the active tab, not the most recently picked block",
    );
    assert.deepEqual(await page.locator("#inspection dd").allTextContents(), [
      node.state,
      `${node.occupancy} / ${node.capacity}`,
    ]);
  }
  await screenshot(page, "block-tabs");
  await page.locator("#close-inspector").click();
  checks.push(
    "Returning between block tabs preserves identity and live model values",
  );

  await page.locator("#reset").click();
  await page.locator("#input-preset").selectOption("stripes");
  const inputBefore = (await snapshot(page)).input;
  const tile = page.locator("#input-tile");
  const tileBox = await tile.boundingBox();
  assert.ok(tileBox);
  await tile.click({
    position: { x: tileBox.width / 16, y: tileBox.height / 16 },
  });
  const drawnInput = (await snapshot(page)).input;
  assert.notDeepEqual(
    drawnInput,
    inputBefore,
    "Drawing changes numerical input",
  );
  await tile.focus();
  await tile.press("Space");
  assert.notDeepEqual(
    (await snapshot(page)).input,
    drawnInput,
    "Keyboard input changes a matrix cell",
  );
  checks.push("Pointer and keyboard editing change the actual input matrix");

  const outputs = [];
  for (const family of ["cpu", "gpu", "tensor"]) {
    await page.locator(`[data-family="${family}"]`).click();
    await page.locator("#input-preset").selectOption("diagonal");
    const before = await snapshot(page);
    assert.equal(before.mode, family);
    assert.equal(before.tick, 0, "Changing input begins a fresh run");
    const complete = await finish(page);
    assertComplete(
      complete,
      `${family} matches independent matrix multiplication`,
    );
    outputs.push({
      input: complete.input,
      weights: complete.weights,
      output: complete.output,
    });
    await screenshot(page, family);
  }
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[1], outputs[2]);
  checks.push("CPU/GPU/tensor output agrees with independent C=A×B reference");

  await page.locator('[data-family="gpu"]').click();
  await page.locator("#input-preset").selectOption("checker");
  await page.locator("#memory-layout").selectOption("packed");
  const packed = await finish(page);
  await page.locator("#memory-layout").selectOption("strided");
  const strided = await finish(page);
  assertComplete(packed, "Packed GPU reference");
  assertComplete(strided, "Strided GPU reference");
  assert.deepEqual(strided.input, packed.input);
  assert.deepEqual(strided.output, packed.output);
  assert.ok(
    strided.counters.sectors > packed.counters.sectors,
    "Scattered addresses request more sectors without changing the answer",
  );
  checks.push("Layout changes traffic while preserving the numerical result");

  await page.locator("#reference").click();
  assert.equal(await page.locator("#inspector").isVisible(), true);
  const referenceTab = page.locator(
    '#inspector [data-panel][aria-selected="true"]',
  );
  const referenceKey = await referenceTab.getAttribute("data-panel");
  assert.ok(referenceKey, "Reference has a selected tab");
  await page.locator("#inspector [data-source]").first().click();
  const tabs = await page
    .locator("#inspector [data-panel]")
    .evaluateAll((items) => items.map((item) => item.dataset.panel));
  assert.ok(
    tabs.includes(referenceKey),
    "Source reading retains the reference tab",
  );
  assert.ok(tabs.length >= 2, "Source opens an additional tab");
  const external = page.locator('#inspector a[href^="https://"]');
  assert.ok(await external.count(), "Source links to its primary reference");
  await page.locator(`#inspector [data-panel="${referenceKey}"]`).click();
  assert.equal(
    await page
      .locator(`#inspector [data-panel="${referenceKey}"]`)
      .getAttribute("aria-selected"),
    "true",
  );
  await screenshot(page, "source-tabs");
  // A fresh page keeps panel dismissal independent of the inspector's design.
  await page.close();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await ready(page);
  checks.push("Source tabs preserve and restore the reference context");

  await page.locator('[data-family="switch"]').click();
  await page.locator("#queue-mode").selectOption("fifo");
  await page.locator("#reset").click();
  await page.locator("#block-0").click();
  await page.locator("#inject-0").click();
  await page.locator("#inject-1").click();
  let fabric = await snapshot(page);
  assertConserved(fabric);
  assert.equal(fabric.blocked[0], true);
  assert.equal(fabric.config.queue_mode, "fifo");
  for (let i = 0; i < 8; i++) await page.locator("#step").click();
  fabric = await snapshot(page);
  assertConserved(fabric);
  assert.equal(fabric.delivered_by_egress[0], 0);
  assert.equal(
    fabric.delivered_by_egress[1],
    0,
    "FIFO head blocks following traffic",
  );
  assert.ok(fabric.occupied > 0);
  const admittedBeforeSwitch = fabric.admitted;
  await page.locator("#queue-mode").selectOption("voq");
  for (let i = 0; i < 8; i++) await page.locator("#step").click();
  fabric = await snapshot(page);
  assertConserved(fabric);
  assert.equal(
    fabric.admitted,
    admittedBeforeSwitch,
    "Mode change retains packets",
  );
  assert.equal(fabric.delivered_by_egress[0], 0);
  assert.ok(
    fabric.delivered_by_egress[1] > 0,
    "VOQ releases unblocked traffic",
  );
  await screenshot(page, "switch-blocked");
  await page.locator("#block-0").click();
  for (let i = 0; i < 40 && (await snapshot(page)).occupied; i++) {
    await page.locator("#step").click();
  }
  fabric = await snapshot(page);
  assertConserved(fabric);
  assert.equal(
    fabric.occupied,
    0,
    "Releasing the egress drains admitted traffic",
  );
  await page.locator("#reset").click();
  fabric = await snapshot(page);
  assertConserved(fabric);
  assert.equal(fabric.attempted, 0);
  assert.equal(fabric.tick, 0);
  assert.deepEqual(fabric.blocked, [false, false, false]);
  checks.push(
    "Blocked FIFO, VOQ intervention, conservation, drain and switch reset",
  );

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await ready(mobile);
  const quiet = await snapshot(mobile);
  await mobile.waitForTimeout(300);
  assert.deepEqual(
    await snapshot(mobile),
    quiet,
    "Reduced motion starts paused",
  );
  await assertNoOverflow(mobile);
  await mobile.locator('[data-family="cpu"]').tap();
  await mobile.locator("#input-preset").selectOption("stripes");
  const touchBefore = (await snapshot(mobile)).input;
  const touchBox = await mobile.locator("#input-tile").boundingBox();
  assert.ok(touchBox);
  await mobile.touchscreen.tap(
    touchBox.x + touchBox.width / 16,
    touchBox.y + touchBox.height / 16,
  );
  assert.notDeepEqual((await snapshot(mobile)).input, touchBefore);
  await mobile.locator("#step").tap();
  assert.equal((await snapshot(mobile)).tick, 1);
  await screenshot(mobile, "mobile-compute");
  await mobile.locator('[data-family="switch"]').tap();
  await mobile.locator("#inject-2").tap();
  assertConserved(await snapshot(mobile));
  await assertNoOverflow(mobile);
  await screenshot(mobile, "mobile-switch");
  await mobile.locator("#reference").tap();
  const panelBox = await mobile.locator("#inspector").boundingBox();
  assert.ok(panelBox && panelBox.x >= -1 && panelBox.x + panelBox.width <= 391);
  await assertNoOverflow(mobile);
  await screenshot(mobile, "mobile-reference");
  await mobile.close();
  checks.push(
    "390×844 touch input, controls, inspector bounds and reduced motion",
  );

  if (backend !== "webgl") {
    const gl = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const glUrl = new URL(appUrl);
    glUrl.searchParams.set("backend", "webgl");
    await ready(gl, glUrl.href);
    await gl.locator('[data-family="tensor"]').click();
    assertComplete(await finish(gl), "WebGL tensor result");
    await screenshot(gl, "webgl");
    await gl.close();
    checks.push("WebGL fallback loads and preserves numerical output");
  }

  assert.deepEqual(errors, [], "No uncaught browser errors");
  assert.deepEqual(requests, [], "All requested assets loaded successfully");
  const report = {
    status: "passed",
    url: appUrl.href,
    backend,
    checks,
    errors,
    requests,
  };
  fs.writeFileSync(
    path.join(outputDir, "results.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed())
    await screenshot(page, "failure").catch(() => {});
  fs.writeFileSync(
    path.join(outputDir, "results.json"),
    JSON.stringify(
      {
        status: "failed",
        url: appUrl.href,
        backend,
        checks,
        errors,
        requests,
        failure: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
