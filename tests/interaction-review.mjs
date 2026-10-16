/** Regressions found while reviewing the expanded hardware UI against Rust state. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const isMac = process.platform === "darwin";
const backend = process.env.DOKE_BACKEND || (isMac ? "webgpu" : "webgl");
const url = new URL(process.env.DOKE_URL || "http://127.0.0.1:4181");
url.searchParams.set("backend", backend);
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
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
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
    "The requested renderer is active",
  );

  // Keep a physical-resource inspector open while its assigned output changes.
  // Its action must follow the resource's current output, not its old output.
  for (const [profile, key] of [
    ["tpu-v1", "pe0"],
    ["rtx-5090", "lane0"],
  ]) {
    const mapping = await page.evaluate(
      ({ profile, key }) => {
        const d = window.dokeFocused;
        d.setHardware(profile);
        d.reset();
        d.setLevel("execution");
        d.inspectBlock(key);
        const output = () =>
          d.snapshot().lanes.find((lane) => lane.lane === 0).output_index;
        const before = output();
        let ticks = 0;
        while (output() === before && ticks++ < 1500) d.advance();
        return { before, after: output(), tick: d.snapshot().tick };
      },
      { profile, key },
    );
    assert.notEqual(mapping.before, mapping.after, `${profile}: group changed`);
    assert.ok(Number.isInteger(mapping.after));
    await page.locator('#inspection [data-follow-lane="0"]').click();
    assert.equal(
      await page.evaluate(() => window.dokeFocused.getState().pinnedOutput),
      mapping.after,
      `${profile}: inspector follows the current lane assignment`,
    );
    const state = await page.evaluate(() => window.dokeFocused.snapshot());
    assert.equal(
      Number(await page.locator(".term-value").textContent()),
      state.detail.outputs[mapping.after].accumulated_sum,
      `${profile}: inspector value is the actual retired sum`,
    );
    checks.push(
      `${profile}: current resource/output mapping at tick ${mapping.tick}`,
    );
  }

  await page.evaluate(() => {
    window.dokeFocused.setHardware("tpu-v1");
    window.dokeFocused.setLevel("execution");
    window.dokeFocused.inspectBlock("pe0");
  });
  assert.equal(await page.locator("#inspection h2").textContent(), "PE 1");
  await page.locator("#inspection [data-state]").click();
  const peLabels = await page.locator(".sector-grid > span").allTextContents();
  assert.equal(peLabels.length, 16);
  peLabels.forEach((label, index) =>
    assert.ok(label.startsWith(`PE ${index + 1} · `), label),
  );
  checks.push("PE inspector and live-state numbering agree");

  // The Mix transform can reach 28, above the input's maximum of 7.
  // Distinct completed positive values must remain visibly distinct.
  await page.locator("#input-toggle").click();
  await page.locator("#input-preset").selectOption("diagonal");
  await page.locator("#operation").selectOption("mix");
  await page.evaluate(() => window.dokeFocused.finish());
  const colors = await page.evaluate(() => {
    const snapshot = window.dokeFocused.snapshot();
    const context = document.querySelector("#output-tile").getContext("2d");
    return [...new Set(snapshot.output)]
      .sort((a, b) => a - b)
      .map((value) => {
        const index = snapshot.output.indexOf(value);
        return {
          value,
          rgba: [
            ...context.getImageData(
              (index % 8) * 32 + 16,
              Math.floor(index / 8) * 32 + 16,
              1,
              1,
            ).data,
          ],
        };
      });
  });
  assert.ok(colors.filter(({ value }) => value > 7).length >= 2);
  assert.equal(
    new Set(colors.map(({ rgba }) => rgba.join(","))).size,
    colors.length,
  );
  for (let index = 1; index < colors.length; index++)
    assert.ok(colors[index].rgba[0] > colors[index - 1].rgba[0]);
  checks.push(
    `Weighted output colors remain distinct: ${colors.map((c) => c.value).join(", ")}`,
  );

  await page.locator("#reader-close").click();
  for (const width of [320, 360, 390, 700, 701, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const profile of ["ryzen-9950x", "tpu-v1", "silicon-one-g200"]) {
      await page.locator("#hardware").selectOption(profile);
      const bounds = await page.evaluate(() => {
        const rect = (selector) => {
          const b = document.querySelector(selector).getBoundingClientRect();
          return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        };
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          brand: rect(".brand"),
          worlds: rect(".worlds"),
          selector: rect("#hardware"),
          brain: rect('[data-world="brain"]'),
          actions: rect(".header-actions"),
        };
      });
      const overlap = (a, b) =>
        a.right > b.left &&
        a.left < b.right &&
        a.bottom > b.top &&
        a.top < b.bottom;
      assert.equal(
        bounds.scrollWidth,
        bounds.width,
        `${width}/${profile}: no overflow`,
      );
      for (const [name, box] of Object.entries(bounds).filter(
        ([, b]) => typeof b === "object",
      )) {
        assert.ok(
          box.left >= 0 && box.right <= width,
          `${width}/${profile}: ${name} within viewport`,
        );
      }
      assert.ok(
        !overlap(bounds.selector, bounds.brain),
        `${width}/${profile}: picker/brain separate`,
      );
      assert.ok(
        !overlap(bounds.worlds, bounds.actions),
        `${width}/${profile}: navigation/actions separate`,
      );
      assert.ok(
        !overlap(bounds.worlds, bounds.brand),
        `${width}/${profile}: navigation/brand separate`,
      );
    }
  }
  checks.push("Hardware header fits at 320–1024 px across CPU, NPU and ASIC");
  assert.deepEqual(errors, [], "No browser exceptions");
  console.log(JSON.stringify({ backend, checks, errors }, null, 2));
} finally {
  await browser.close();
}
