/** End-to-end checks for NPU arithmetic, ASIC queues and scoped time evidence. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";

const isMac = process.platform === "darwin";
const backend = process.env.DOKE_BACKEND || (isMac ? "webgpu" : "webgl");
const url = new URL(process.env.DOKE_URL || "http://127.0.0.1:4181");
url.searchParams.set("backend", backend);
const skipBrain = process.env.DOKE_SKIP_BRAIN === "1";
const architecture = JSON.parse(
  fs.readFileSync(new URL("../public/architecture.json", import.meta.url)),
);
const evidence = JSON.parse(
  fs.readFileSync(new URL("../public/timescales.json", import.meta.url)),
);
const errors = [],
  checks = [];
const prefix = `test-results/hardware-expansion-${backend}`;
fs.mkdirSync("test-results", { recursive: true });
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
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.dokeFocused.snapshot());
const state = () => page.evaluate(() => window.dokeFocused.getState());
const finish = () => page.evaluate(() => window.dokeFocused.finish());
async function closePanel() {
  if (await page.locator("#reader").isVisible())
    await page.locator("#reader-close").click();
}
async function select(id) {
  await page.locator("#hardware").selectOption(id);
  assert.equal((await state()).profile, id);
}
function arithmetic(s) {
  assert.equal(s.status, "complete");
  assert.equal(s.counters.macs, 512);
  assert.equal(s.counters.completed_outputs, 64);
  assert.ok(s.valid.every(Boolean));
  const expected = Array(64).fill(0);
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      for (let k = 0; k < 8; k++)
        expected[row * 8 + col] +=
          s.input[row * 8 + k] * s.weights[k * 8 + col];
  assert.deepEqual(s.output, expected);
  assert.equal(
    s.detail.outputs.reduce((sum, out) => sum + out.retired_terms, 0),
    512,
  );
  for (const out of s.detail.outputs) {
    assert.equal(out.terms.length, 8);
    assert.equal(out.stored, true);
    let sum = 0;
    for (const term of out.terms) {
      assert.equal(term.product, term.a * term.b || 0);
      sum += term.product;
      assert.equal(term.sum_after, sum);
    }
    assert.equal(out.accumulated_sum, sum);
  }
}
function conserved(s) {
  assert.equal(s.conserved, true);
  assert.equal(s.attempted, s.dropped + s.delivered + s.occupied);
  assert.equal(s.admitted, s.delivered + s.occupied);
  assert.equal(s.occupied, s.buffered + s.in_flight);
  assert.ok(s.occupied <= s.capacity_packets);
  assert.equal(s.packets.length, s.occupied);
  assert.equal(new Set(s.packets.map((packet) => packet.id)).size, s.occupied);
}
try {
  // Evidence already lives in the root page. A slow optional atlas import must
  // not make its visible Timing & parts button silently discard a click.
  await page.route("**/brain-comparison.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await route.continue();
  });
  if (skipBrain) {
    for (const file of ["atlas.json", "brain.bin"])
      await page.route(`**/assets/${file}`, (route) =>
        route.fulfill({ status: 503, body: "Intentional unavailable atlas" }),
      );
  }
  await page.goto(url.href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.ready === "true" &&
      window.dokeFocused?.getState().rendererReady,
    null,
    { timeout: 90000 },
  );
  assert.match(
    await page.evaluate(() => window.dokeFocused.getRenderer().backend()),
    backend === "webgl" ? /\bGl\b/ : /BrowserWebGpu/,
  );
  const profiles = [
    "ryzen-9950x",
    "rtx-5090",
    "h100-sxm",
    "tpu-v1",
    "silicon-one-g200",
  ];
  assert.deepEqual(
    await page
      .locator("#hardware option")
      .evaluateAll((items) => items.map((item) => item.value).filter(Boolean)),
    profiles,
  );
  assert.equal(
    await page.locator("#profile").count(),
    0,
    "One hardware picker replaces duplicated controls",
  );
  const answers = {};
  for (const id of ["ryzen-9950x", "rtx-5090", "tpu-v1"]) {
    await select(id);
    for (const level of ["processor", "core", "execution"]) {
      await page.locator(`button[data-level="${level}"]`).click();
      assert.equal((await state()).level, level);
    }
    if (id === "tpu-v1") {
      assert.equal((await state()).family, "tensor");
      assert.equal(
        await page.evaluate(
          () =>
            window.dokeFocused
              .layout()
              .blocks.filter((block) => /^pe\d+$/.test(block.key)).length,
        ),
        16,
      );
    }
    await page.locator("#input-toggle").click();
    await page.locator("#input-preset").selectOption("checker");
    for (const operation of ["difference", "mix", "identity"]) {
      await page.locator("#operation").selectOption(operation);
      assert.equal((await state()).operation, operation);
      assert.equal(
        (await snapshot()).tick,
        0,
        "Changing the operation clears previous work",
      );
      const done = await finish();
      arithmetic(done);
      if (operation === "identity") assert.deepEqual(done.output, done.input);
      if (answers[operation])
        assert.deepEqual(
          done.output,
          answers[operation],
          `${operation}: all schedules agree`,
        );
      else answers[operation] = done.output;
    }
    await closePanel();
  }
  assert.notDeepEqual(answers.difference, answers.mix);
  assert.notDeepEqual(answers.identity, answers.mix);
  await page.evaluate(() => window.dokeFocused.pin(9));
  assert.equal(
    await page
      .locator('#inspection table[aria-label="Completed products"] tbody tr')
      .count(),
    8,
  );
  await page.screenshot({ path: `${prefix}-npu.png` });
  checks.push(
    "CPU, GPU and NPU: three operations, independent matrix reference and all512retired products",
  );

  await select("silicon-one-g200");
  await page.locator('button[data-level="execution"]').click();
  let s = await snapshot();
  conserved(s);
  assert.equal(s.occupied, 18);
  assert.equal(s.delivered, 0);
  await page.locator("#input-toggle").click();
  assert.equal(await page.locator("[data-inject]").count(), 3);
  assert.equal(await page.locator("[data-block]").count(), 3);
  await page.locator("#queue-mode").selectOption("fifo");
  await page.locator('[data-block="0"]').click();
  s = await finish();
  conserved(s);
  assert.equal(s.config.queue_mode, "fifo");
  assert.equal(s.blocked[0], true);
  assert.equal(
    s.delivered,
    0,
    "FIFO blocked heads prevent later destinations from passing",
  );
  assert.equal(s.occupied, 18);
  await page.locator("#queue-mode").selectOption("voq");
  assert.equal(
    (await snapshot()).occupied,
    18,
    "Changing queue mode preserves admitted packets",
  );
  s = await finish();
  conserved(s);
  assert.equal(s.delivered, 12);
  assert.deepEqual(s.delivered_by_egress, [0, 6, 6]);
  assert.equal(s.occupied, 6);
  await page.screenshot({ path: `${prefix}-asic-blocked.png` });
  await page.locator('[data-block="0"]').click();
  s = await finish();
  conserved(s);
  assert.equal(s.delivered, 18);
  assert.equal(s.occupied, 0);
  await page.locator("#reset").click();
  s = await snapshot();
  assert.equal(s.config.queue_mode, "voq");
  assert.equal(s.tick, 0);
  assert.equal(s.occupied, 18);
  assert.deepEqual(s.blocked, [false, false, false]);
  for (let i = 0; i < 5; i++)
    await page.locator(`[data-inject="${i % 3}"]`).click();
  s = await snapshot();
  conserved(s);
  assert.equal(s.attempted, 48);
  assert.equal(s.occupied, 32);
  assert.equal(s.dropped, 16);
  await closePanel();
  await page.locator("#run").click();
  assert.ok((await snapshot()).tick > 0);
  await page.locator("#run").click();
  assert.equal((await state()).playing, false);
  const paused = await snapshot();
  await page.waitForTimeout(180);
  assert.deepEqual(await snapshot(), paused);
  conserved(await finish());
  checks.push(
    "ASIC seed traffic, FIFO/VOQ blocked-output behavior, exact conservation, capacity drops and immediate pause",
  );

  for (const id of profiles) {
    await select(id);
    if (!(await state()).comparing)
      await page.locator("#compare-toggle").click();
    await page.locator("#brain-guide-evidence").click();
    const timing = architecture.profiles[id].timing;
    const clocks = page.locator("#inspection [data-clock-seconds]");
    if (timing.kind === "clock") {
      assert.equal(await clocks.count(), 1);
      const seconds = Number(await clocks.getAttribute("data-clock-seconds"));
      assert.ok(Math.abs(seconds * timing.hz - 1) < 1e-9);
    } else {
      assert.equal(
        await clocks.count(),
        0,
        `${id}: ${timing.kind} is not a clock`,
      );
      assert.match(
        await page.locator("#inspection").textContent(),
        timing.kind === "bandwidth" ? /bandwidth/i : /throughput/i,
      );
    }
    for (const row of evidence.measurements) {
      const displayed = page.locator(
        `#inspection [data-measurement="${row.id}"]`,
      );
      assert.equal(await displayed.count(), 1);
      assert.equal(
        Number(await displayed.getAttribute("data-min-seconds")),
        row.minSeconds,
      );
      assert.equal(
        Number(await displayed.getAttribute("data-max-seconds")),
        row.maxSeconds,
      );
    }
    const tab = await page
      .locator('#reader-tabs [aria-selected="true"]')
      .getAttribute("data-tab");
    await page
      .getByText("Hardware reference & conditions", { exact: true })
      .click();
    await page
      .locator("#inspection details[open] [data-source]")
      .first()
      .click();
    assert.ok(await page.locator('#inspection a[href^="https://"]').count());
    await page.locator(`#reader-tabs [data-tab="${tab}"]`).click();
    assert.equal(
      await page.locator("#inspection [data-measurement]").count(),
      4,
    );
    if (id === "ryzen-9950x") {
      const biological = page.locator(
        '#inspection [data-measurement="human-synaptic-onset"]',
      );
      await biological.locator("summary").click();
      assert.match(await biological.textContent(), /38 postsynaptic cells/);
      await biological.locator("[data-source]").click();
      assert.ok(
        (
          await page
            .locator('#inspection a[href^="https://"]')
            .evaluateAll((links) => links.map((link) => link.href))
        ).includes(evidence.sources["molnar-2008"].url),
      );
      await page.locator(`#reader-tabs [data-tab="${tab}"]`).click();
      assert.equal(
        await page.locator("#inspection [data-measurement]").count(),
        4,
      );
    }
    await closePanel();
  }
  await select("tpu-v1");
  await page.locator("#brain-guide-evidence").click();
  await page.screenshot({ path: `${prefix}-timescales.png` });
  checks.push(
    "Five profiles: sourced periods only for clocks, biological measurement units and restorable evidence tabs",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  const bounds = await page.locator("#reader").boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 391 &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= 845,
  );
  await page.screenshot({ path: `${prefix}-mobile.png` });
  assert.deepEqual(errors, []);
  const report = { status: "passed", backend, skipBrain, checks, errors };
  fs.writeFileSync(`${prefix}-results.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: `${prefix}-failure.png` }).catch(() => {});
  fs.writeFileSync(
    `${prefix}-results.json`,
    JSON.stringify(
      { status: "failed", checks, errors, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
