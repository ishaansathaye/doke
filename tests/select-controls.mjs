/** Picker behavior: native model contracts, keyboard access and floating layout. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const isMac = process.platform === "darwin";
const url = new URL(process.env.DOKE_URL || "http://127.0.0.1:4181");
url.searchParams.set("backend", "webgl");
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_BIN ||
    process.env.CHROME_PATH ||
    (isMac
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined),
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: "reduce",
});
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const picker = (id) => page.locator(`[data-select="${id}"] .select-trigger`);
const menu = page.locator("#doke-select-menu");
const value = (id) => page.locator(`#${id}`).inputValue();
async function fits() {
  const bounds = await menu.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds, "The popup is visible");
  assert.ok(bounds.x >= 0 && bounds.y >= 0, "Popup starts inside viewport");
  assert.ok(
    bounds.x + bounds.width <= viewport.width &&
      bounds.y + bounds.height <= viewport.height,
    "Popup ends inside viewport",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    viewport.width,
    "No horizontal page overflow",
  );
}
try {
  await page.goto(url.href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.ready === "true" &&
      window.dokeFocused?.getState().rendererReady,
    null,
    { timeout: 90000 },
  );
  await picker("hardware").click();
  assert.equal(await menu.getByRole("group").count(), 4);
  assert.equal(
    await menu.locator('[aria-selected="true"]').textContent(),
    "RTX 5090 · GPU✓",
  );
  assert.equal(await menu.getByRole("option").count(), 5);
  await fits();
  await picker("hardware").press("Home");
  await picker("hardware").press("Enter");
  assert.equal(await value("hardware"), "ryzen-9950x");
  assert.equal(
    await page.evaluate(() => window.dokeFocused.getState().family),
    "cpu",
  );
  assert.equal(await menu.isVisible(), false);
  assert.equal(
    await picker("hardware").evaluate(
      (node) => node === document.activeElement,
    ),
    true,
  );
  await picker("hardware").press("g");
  await picker("hardware").press("Enter");
  assert.equal(await value("hardware"), "tpu-v1");
  checks.push(
    "Grouped hardware list, selection marks, Home/Enter and typeahead",
  );

  // Both test automation and app-side assignment continue to use native selects.
  await page.locator("#hardware").selectOption("h100-sxm");
  assert.match(await picker("hardware").textContent(), /H100/);
  await page.evaluate(() => window.dokeFocused.setHardware("silicon-one-g200"));
  assert.match(await picker("hardware").textContent(), /Cisco G200/);
  await page.locator('[data-world="brain"]').click();
  assert.match(await picker("hardware").textContent(), /Select hardware/);
  await page.locator("#hardware").selectOption("rtx-5090");
  checks.push("Native selectOption and programmatic values stay synchronized");

  await page.locator("#input-toggle").click();
  await picker("operation").click();
  await picker("operation").press("End");
  await picker("operation").press("Escape");
  assert.equal(await menu.isVisible(), false);
  assert.equal(await page.locator("#reader").isVisible(), true);
  assert.equal(
    await value("operation"),
    "difference",
    "Escape cancels changes",
  );
  await picker("operation").click();
  await menu
    .getByRole("option", { name: "Weighted neighbors · A × B" })
    .click();
  assert.equal(
    await page.evaluate(() => window.dokeFocused.getState().operation),
    "mix",
  );
  assert.match(await picker("operation").textContent(), /Weighted neighbors/);
  await picker("input-preset").click();
  await picker("input-preset").press("Tab");
  assert.equal(
    await menu.isVisible(),
    false,
    "Tab closes without trapping focus",
  );
  await picker("input-preset").click();
  await page.locator("#reset-camera").click();
  assert.equal(await menu.isVisible(), false, "Outside click dismisses");
  checks.push(
    "Dynamic inspector controls, Escape cancellation, Tab and outside click",
  );

  // While running, live inspector HTML must not replace the focused picker.
  await page.locator("#run").click();
  await picker("pinned-output").click();
  const focusedId = await picker("pinned-output").evaluate((node) => {
    node.dataset.testIdentity = "retained";
    return node.getAttribute("aria-activedescendant");
  });
  await page.waitForTimeout(450);
  assert.equal(await menu.isVisible(), true);
  assert.equal(
    await picker("pinned-output").getAttribute("data-test-identity"),
    "retained",
  );
  assert.equal(
    await picker("pinned-output").getAttribute("aria-activedescendant"),
    focusedId,
  );
  await picker("pinned-output").press("ArrowDown");
  await picker("pinned-output").press("Enter");
  assert.equal(
    await page.evaluate(() => window.dokeFocused.getState().pinnedOutput),
    1,
  );
  await page.locator("#run").click();
  await page.locator("#reader-close").click();
  checks.push(
    "Open live-output picker retains focus and identity during playback",
  );

  // Fixed overlays fit short displays and narrow mobile widths at both edges.
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 768, height: 540 },
    { width: 390, height: 720 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await picker("hardware").click();
    await fits();
    await picker("hardware").press("Escape");
    await page.locator("#settings-toggle").click();
    await picker("brain-quality").click();
    await fits();
    await picker("brain-quality").press("Escape");
    await page.locator("#settings-toggle").click();
  }
  checks.push(
    "Hardware and settings menus fit 320–1440 px and short viewports",
  );
  assert.deepEqual(errors, [], "No browser exceptions");
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
