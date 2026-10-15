// Integration test: requires locally prepared public/assets/{atlas.json,brain.bin}
// plus built WASM. It deliberately fails if anatomy falls back to text-only.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.DOKE_URL || "http://127.0.0.1:4181";
const isMac = process.platform === "darwin";
const backend = process.env.DOKE_BACKEND || (isMac ? "webgpu" : "webgl");
const url = new URL(base);
if (!url.pathname.endsWith("/silicon.html"))
  url.pathname = url.pathname.replace(/\/$/, "") + "/silicon.html";
url.searchParams.set("compare", "1");
url.searchParams.set("backend", backend);
const output = "test-results/comparison";
fs.mkdirSync(output, { recursive: true });
const errors = [],
  failures = [],
  checks = [];
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
const brain = (page) =>
  page.evaluate(() => window.dokeBrainComparison.snapshot());
const silicon = (page) => page.evaluate(() => window.dokeSilicon.snapshot());
const snap = (page, name) => page.screenshot({ path: `${output}/${name}.png` });

async function load(page, target = url.href, missing = false) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !(missing && /\/assets\/brain\.bin$/.test(response.url()))
    )
      failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) =>
    failures.push(`${request.failure()?.errorText} ${request.url()}`),
  );
  await page.goto(target);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.ready === "true" &&
      window.dokeBrainComparison &&
      (window.dokeBrainComparison.snapshot().ready ||
        window.dokeBrainComparison.snapshot().error),
    null,
    { timeout: 90000 },
  );
  assert.equal(await page.title(), "doke");
  if (missing) return;
  const state = await brain(page);
  assert.equal(state.ready, true, `Reference atlas must load: ${state.error}`);
  assert.equal(state.error, null);
  const expected =
    new URL(target).searchParams.get("backend") === "webgl"
      ? /\bGl\b/
      : /BrowserWebGpu/;
  assert.match(state.backend, expected);
  assert.match(await page.locator("#render-status").textContent(), expected);
  const mesh = await page.evaluate(async () => {
    const response = await fetch("assets/brain.bin");
    if (!response.ok) throw new Error("Local atlas mesh required");
    const data = await response.arrayBuffer();
    const view = new DataView(data);
    return {
      signature: new TextDecoder().decode(data.slice(0, 4)),
      expected: view.getUint32(8, true) / 3,
      actual: window.dokeBrainComparison.getRenderer().triangle_count(),
      distinct:
        window.dokeBrainComparison.getRenderer() !==
        window.dokeSilicon.getRenderer(),
    };
  });
  assert.equal(mesh.signature, "BRN1");
  assert.ok(
    mesh.expected > 10000,
    "Real prepared atlas, not a placeholder primitive",
  );
  assert.equal(
    mesh.actual,
    mesh.expected,
    "All atlas triangles loaded into the brain renderer",
  );
  assert.equal(mesh.distinct, true, "Independent renderer instances");
}

async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
}

let page;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await load(page);
  assert.equal(await page.locator("#brain-canvas").isVisible(), true);
  assert.equal(await page.locator("#chip-canvas").isVisible(), true);
  const initialBrain = await brain(page),
    initialSilicon = await silicon(page);
  assert.equal(initialBrain.playing, false);
  assert.equal(initialBrain.time, 0);
  await page.waitForTimeout(250);
  assert.deepEqual(
    await brain(page),
    initialBrain,
    "Reduced motion starts the guide paused",
  );
  checks.push("Two distinct 3D renderers and complete local atlas geometry");

  await page.locator("#brain-guide-play").click();
  await page.waitForFunction(
    () => window.dokeBrainComparison.snapshot().time > 0.15,
  );
  await page.locator("#brain-guide-play").click();
  const paused = await brain(page);
  assert.equal(paused.playing, false);
  await page.waitForTimeout(250);
  assert.deepEqual(
    await brain(page),
    paused,
    "Pausing freezes the authored guide clock",
  );
  assert.deepEqual(
    await silicon(page),
    initialSilicon,
    "Guide playback does not execute silicon",
  );
  await page.locator("#brain-guide-next").click();
  let state = await brain(page);
  assert.equal(state.stageIndex, 1);
  assert.equal(state.time, 4);
  assert.equal(state.playing, false);
  assert.deepEqual(
    await silicon(page),
    initialSilicon,
    "Next does not alter silicon state",
  );
  await page.locator("#brain-guide-reset").click();
  assert.equal((await brain(page)).time, 0);
  assert.deepEqual(
    await silicon(page),
    initialSilicon,
    "Guide reset preserves silicon state",
  );
  const beforeSiliconStep = await brain(page);
  await page.locator("#step").click();
  assert.equal((await silicon(page)).tick, initialSilicon.tick + 1);
  assert.deepEqual(
    await brain(page),
    beforeSiliconStep,
    "Silicon execution does not advance biology guide",
  );
  checks.push("Independent play/pause/next/reset and silicon clocks");

  await page.locator("#brain-guide-next").click();
  const beforeInput = await brain(page);
  await page.locator("#input-preset").selectOption("checker");
  state = await brain(page);
  assert.notDeepEqual(state.input, beforeInput.input);
  assert.deepEqual(state.input, (await silicon(page)).input);
  const { input: oldInput, ...oldGuide } = beforeInput;
  const { input: newInput, ...newGuide } = state;
  assert.deepEqual(
    newGuide,
    oldGuide,
    "Shared image does not invent a neural response or reset authored timing",
  );
  assert.match(
    await page.locator("#brain-stimulus").getAttribute("aria-label"),
    /does not drive a brain simulation/,
  );
  checks.push(
    "Shared numerical input changes while authored brain state remains independent",
  );

  await page.locator("#brain-guide-evidence").click();
  const guideKey = await page
    .locator('#inspector [data-panel][aria-selected="true"]')
    .getAttribute("data-panel");
  const guideHeading = await page.locator("#inspection h2").textContent();
  assert.ok(guideKey.startsWith("brain-guide:"));
  await page
    .locator('#inspection [data-comparison-source="vision-timing"]')
    .click();
  assert.match(await page.locator("#inspection").textContent(), /150/);
  assert.match(
    await page.locator("#inspection").textContent(),
    /ERP|event-related/i,
  );
  assert.ok(await page.locator('#inspection a[href^="https://"]').count());
  await page.locator(`[data-panel="${guideKey}"]`).click();
  assert.equal(
    await page.locator("#inspection h2").textContent(),
    guideHeading,
  );
  await snap(page, "evidence-tabs");
  await page.locator("#close-inspector").click();
  checks.push(
    "Brain evidence/source tabs preserve context and ERP timing scope",
  );

  const hit = await page.evaluate(async () => {
    const atlas = await (await fetch("assets/atlas.json")).json();
    const renderer = window.dokeBrainComparison.getRenderer();
    const canvas = document.querySelector("#brain-canvas"),
      rect = canvas.getBoundingClientRect();
    for (let y = 0.25; y <= 0.75; y += 0.1)
      for (let x = 0.25; x <= 0.75; x += 0.1) {
        const id = renderer.pick(x, y);
        const region = atlas.regions.find((item) => item.index === id);
        const px = rect.x + x * rect.width,
          py = rect.y + y * rect.height;
        if (region && document.elementFromPoint(px, py) === canvas)
          return { x: px, y: py, id: region.id, name: region.name };
      }
    return null;
  });
  assert.ok(hit, "Atlas exposes a visible pickable anatomical surface");
  await page.mouse.click(hit.x, hit.y);
  await page.locator(`[data-panel="brain-region:${hit.id}"]`).waitFor();
  assert.equal(await page.locator("#inspection h2").textContent(), hit.name);
  await page.locator("#close-inspector").click();
  checks.push(
    "Actual atlas surface picking opens the corresponding anatomical evidence",
  );

  const mechanisms = await page.evaluate(
    async () => (await (await fetch("comparison.json")).json()).mechanisms,
  );
  for (const family of ["cpu", "gpu", "tensor", "switch"]) {
    await page.locator(`[data-family="${family}"]`).click();
    await page.locator("#compare-mechanisms").click();
    const headings = await page.locator("#inspection h3").allTextContents();
    assert.ok(headings.includes(mechanisms.find((m) => m.id === family).label));
    assert.ok(
      headings.includes(mechanisms.find((m) => m.id === "human").label),
    );
    for (const other of mechanisms.filter(
      (m) => ![family, "human"].includes(m.id),
    ))
      assert.ok(!headings.includes(other.label));
    await page.locator("#close-inspector").click();
  }
  await page.locator('[data-family="gpu"]').click();
  await snap(page, "desktop");
  checks.push("Mechanism comparison follows the current hardware family");

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await load(mobile);
  await noOverflow(mobile);
  assert.equal(await mobile.locator("#chip-canvas").isVisible(), true);
  await mobile.locator("#step").tap();
  const mobileHardware = await silicon(mobile);
  await snap(mobile, "mobile-silicon");
  await mobile.locator('[data-comparison-view="brain"]').tap();
  assert.equal(await mobile.locator("#brain-canvas").isVisible(), true);
  assert.equal(await mobile.locator("#chip-canvas").isVisible(), false);
  await mobile.locator("#brain-guide-next").tap();
  assert.equal((await brain(mobile)).stageIndex, 1);
  assert.deepEqual(await silicon(mobile), mobileHardware);
  await noOverflow(mobile);
  await snap(mobile, "mobile-brain");
  await mobile.locator("#brain-guide-evidence").tap();
  const bounds = await mobile.locator("#inspector").boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await mobile.locator("#close-inspector").tap();
  await mobile.locator('[data-comparison-view="silicon"]').tap();
  assert.equal(await mobile.locator("#step").isVisible(), true);
  await mobile.close();
  checks.push(
    "390px touch layout exposes both views and evidence without overflow",
  );

  if (backend !== "webgl") {
    const gl = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const glUrl = new URL(url);
    glUrl.searchParams.set("backend", "webgl");
    await load(gl, glUrl.href);
    await gl.locator("#brain-guide-next").click();
    assert.equal((await brain(gl)).stageIndex, 1);
    await snap(gl, "webgl");
    await gl.close();
    checks.push("Both actual 3D canvases also initialize with WebGL");
  }

  const fallback = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await fallback.route("**/assets/brain.bin", (route) =>
    route.fulfill({
      status: 404,
      body: "Atlas deliberately unavailable for integration test",
    }),
  );
  await load(fallback, url.href, true);
  assert.equal((await brain(fallback)).ready, false);
  assert.match((await brain(fallback)).error, /atlas unavailable/i);
  assert.match(
    await fallback.locator("#brain-guide-copy").textContent(),
    /3D is unavailable/,
  );
  await fallback.locator("#brain-guide-next").click();
  assert.equal((await brain(fallback)).stageIndex, 1);
  assert.match(
    await fallback.locator("#brain-guide-copy").textContent(),
    /3D is unavailable/,
    "Changing guide stages preserves the unavailable-atlas explanation",
  );
  await fallback.locator("#brain-guide-evidence").click();
  assert.ok(
    await fallback.locator("#inspection [data-comparison-source]").count(),
  );
  await fallback.locator("#close-inspector").click();
  const fallbackTick = (await silicon(fallback)).tick;
  await fallback.locator("#step").click();
  assert.equal((await silicon(fallback)).tick, fallbackTick + 1);
  await snap(fallback, "missing-atlas");
  await fallback.close();
  checks.push(
    "Missing atlas retains guide, sources, and functioning silicon controls",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const report = {
    status: "passed",
    url: url.href,
    backend,
    checks,
    errors,
    failures,
  };
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await snap(page, "failure").catch(() => {});
  fs.writeFileSync(
    `${output}/results.json`,
    JSON.stringify(
      { status: "failed", checks, errors, failures, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
