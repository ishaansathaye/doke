/** Floating panels leave scene navigation and camera controls usable. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const isMac = process.platform === "darwin";
const backend = process.env.DOKE_BACKEND || (isMac ? "webgpu" : "webgl");
const skipBrain = process.env.DOKE_SKIP_BRAIN === "1";
const url = new URL(process.env.DOKE_URL || "http://127.0.0.1:4181");
url.searchParams.set("backend", backend);
const directory = "test-results/layout-review";
const artifactPrefix = `${backend}${skipBrain ? "-no-atlas" : ""}`;
fs.mkdirSync(directory, { recursive: true });
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
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const errors = [],
  failures = [],
  reports = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const overlap = (a, b) =>
  a &&
  b &&
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
const settle = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
async function inspect(name, screenshot = false) {
  await settle();
  const report = await page.evaluate(() => {
    const selectors = [
      "header",
      ".worlds",
      ".scene-heading",
      "#depth-nav",
      "#brain-label",
      "#comparison-mobile",
      "#view-tools",
      "#brain-view-tools",
      "#reader",
      "#settings",
      "#dock",
      "#brain-guide",
      "#chip-canvas",
      "#brain-canvas",
    ];
    const visible = (e) =>
      !!e?.getClientRects().length &&
      getComputedStyle(e).visibility !== "hidden";
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const boxes = Object.fromEntries(
      selectors
        .map((s) => [s, document.querySelector(s)])
        .filter(([, e]) => visible(e))
        .map(([s, e]) => [s, rect(e)]),
    );
    const controls = [
      ...document.querySelectorAll(
        "header button, #depth-nav button, #comparison-mobile button, .view-tools button, #reader-close, #settings-close, #dock button, #brain-guide button",
      ),
    ]
      .filter((e) => visible(e) && !e.disabled)
      .map((e) => {
        const r = rect(e),
          hit = document.elementFromPoint(
            (r.left + r.right) / 2,
            (r.top + r.bottom) / 2,
          );
        return {
          name: e.id || e.textContent.trim(),
          ...r,
          hit: hit === e || e.contains(hit),
        };
      });
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      boxes,
      controls,
    };
  });
  report.name = name;
  reports.push(report);
  check(
    report.scrollWidth <= report.width,
    `${name}: no horizontal page overflow`,
  );
  for (const [selector, rect] of Object.entries(report.boxes)) {
    check(
      rect.left >= -1 &&
        rect.right <= report.width + 1 &&
        rect.top >= -1 &&
        rect.bottom <= report.height + 1,
      `${name}: ${selector} within viewport`,
    );
    if (selector.endsWith("canvas")) {
      const minimumHeight =
        selector === "#chip-canvas" && report.height <= 650 ? 140 : 100;
      check(
        rect.height >= minimumHeight && rect.width >= 150,
        `${name}: ${selector} has usable dimensions (${rect.width}×${rect.height})`,
      );
    }
  }
  for (const panel of ["#reader", "#settings"]) {
    const box = report.boxes[panel];
    if (!box) continue;
    check(
      box.height >= 95,
      `${name}: ${panel} has room for controls and scrollable content (${box.height}px)`,
    );
    for (const other of [
      "header",
      ".worlds",
      ".scene-heading",
      "#depth-nav",
      "#brain-label",
      "#comparison-mobile",
      "#view-tools",
      "#brain-view-tools",
      "#dock",
      "#brain-guide",
    ])
      check(
        !overlap(box, report.boxes[other]),
        `${name}: ${panel} does not overlap ${other}`,
      );
  }
  check(
    !(report.boxes["#reader"] && report.boxes["#settings"]),
    `${name}: reader/settings mutually exclusive`,
  );
  for (const control of report.controls)
    check(control.hit, `${name}: ${control.name} accepts pointer input`);
  if (screenshot)
    await page.screenshot({
      path: `${directory}/${artifactPrefix}-${name}.png`,
    });
  fs.writeFileSync(
    `${directory}/${artifactPrefix}-report.json`,
    JSON.stringify({ reports, failures, errors }, null, 2),
  );
}
async function closeReader() {
  if (await page.locator("#reader").isVisible())
    await page.locator("#reader-close").click();
}
async function cameraStates() {
  return page.evaluate(() => ({
    chip: [...window.dokeFocused.getRenderer().camera_state()],
    brain: [...window.dokeBrainComparison.getRenderer().camera_state()],
  }));
}
async function zoomCheck(selector, target, name) {
  const before = await cameraStates();
  await page.locator(selector).click();
  const after = await cameraStates();
  check(
    after[target][0] < before[target][0],
    `${name}: zoom button moves ${target} closer`,
  );
  const other = target === "brain" ? "chip" : "brain";
  check(
    JSON.stringify(after[other]) === JSON.stringify(before[other]),
    `${name}: ${other} camera remains unchanged`,
  );
  await page
    .locator(target === "brain" ? "#brain-reset-camera" : "#reset-camera")
    .click();
  const reset = await cameraStates();
  check(
    reset[target][0] > after[target][0],
    `${name}: reset restores the ${target} overview`,
  );
  check(
    JSON.stringify(reset[other]) === JSON.stringify(after[other]),
    `${name}: resetting ${target} leaves ${other} unchanged`,
  );
}
try {
  if (skipBrain)
    await page.route("**/assets/{atlas.json,brain.bin}", (route) =>
      route.fulfill({
        status: 503,
        body: "Atlas intentionally unavailable in CI",
      }),
    );
  await page.goto(url.href);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.ready === "true" &&
      window.dokeFocused?.getState().rendererReady,
    null,
    { timeout: 90000 },
  );
  await page.locator("#compare-toggle").click();
  if (!skipBrain)
    await page.waitForFunction(
      () => window.dokeBrainComparison?.snapshot().ready,
      null,
      { timeout: 90000 },
    );
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [844, 390],
    [320, 568],
  ]) {
    await page.setViewportSize({ width, height });
    await settle();
    await page.evaluate(() => {
      window.dokeFocused.setHardware("rtx-5090");
      window.dokeFocused.setLevel("processor");
    });
    if (await page.locator("#comparison-mobile").isVisible())
      await page.locator('button[data-comparison-view="chip"]').click();
    const name = `${width}x${height}`,
      compact = width <= 1000 || height <= 650;
    await inspect(`${name}-compare`, true);
    check(
      (await page.locator("#brain-view-tools").isVisible()) === !compact,
      `${name}: desktop exposes a second camera toolbar`,
    );
    if (!skipBrain && !compact) {
      await zoomCheck("#zoom-in", "chip", name);
      await zoomCheck("#brain-zoom-in", "brain", name);
    }
    await page.locator("#input-toggle").click();
    await inspect(`${name}-input`, true);
    await page.locator("#settings-toggle").click();
    await inspect(`${name}-settings`, true);
    await page.locator("#settings-close").click();
    if (compact)
      await page.locator('button[data-comparison-view="brain"]').click();
    await inspect(`${name}-brain`);
    check(
      await page.locator("#brain-view-tools").isVisible(),
      `${name}: visible brain has camera controls`,
    );
    if (!skipBrain && compact) await zoomCheck("#brain-zoom-in", "brain", name);
    await page.locator("#brain-guide-evidence").click();
    await inspect(`${name}-timing`, true);
    await closeReader();
    await page.locator('[data-world="brain"]').click();
    await settle();
    await page.locator("#anatomy").click();
    await inspect(`${name}-anatomy`);
    await page.locator("#settings-toggle").click();
    await inspect(`${name}-brain-settings`);
    await page.locator("#settings-close").click();
  }
  checks.push(
    "Panel bounds, non-overlap, pointer reachability and usable canvas sizes at six desktop/tablet/phone/landscape sizes",
  );
  if (!skipBrain)
    checks.push(
      "Brain/chip zoom controls target independent real renderer cameras",
    );
  else
    checks.push(
      "Atlas rendering and brain-camera assertions skipped; comparison chrome is checked in its unavailable state",
    );
  // Opening a source must preserve the parent page, including its scroll.
  await page.evaluate(() => window.dokeFocused.setHardware("rtx-5090"));
  await page.locator('button[data-comparison-view="brain"]').click();
  await page.locator("#hardware").selectOption("ryzen-9950x");
  await settle();
  check(
    (await page.locator("#chip-canvas").isVisible()) &&
      (await page
        .locator('button[data-comparison-view="chip"]')
        .getAttribute("aria-pressed")) === "true",
    "Choosing hardware returns compact comparison to the processor",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.dokeFocused.setHardware("rtx-5090"));
  await page.locator("#settings-toggle").click();
  await page.locator("#about").click();
  await settle();
  const source = page.locator("#inspection [data-source]").first();
  await source.scrollIntoViewIfNeeded();
  const parentScroll = await page
    .locator("#inspection")
    .evaluate((el) => el.scrollTop);
  check(parentScroll > 0, "Source navigation starts on a scrolled parent page");
  await source.click();
  const selectedTab = () => page.locator('#reader-tabs [aria-selected="true"]');
  await selectedTab().focus();
  await selectedTab().press("Home");
  check(
    Math.abs(
      (await page.locator("#inspection").evaluate((el) => el.scrollTop)) -
        parentScroll,
    ) <= 1,
    "Returning from a source restores the parent scroll position",
  );
  await selectedTab().press("End");
  check(
    (await page.locator("#inspection .eyebrow").textContent()) ===
      "FOLLOW THE EVIDENCE",
    "End returns to the source tab",
  );
  await selectedTab().press("ArrowLeft");
  await selectedTab().press("ArrowRight");
  check(
    await selectedTab().evaluate((el) => el === document.activeElement),
    "Arrow navigation keeps focus on the selected tab",
  );
  check(
    (await page.locator('#reader-tabs [tabindex="0"]').count()) === 1 &&
      (await page.locator("#inspection").getAttribute("aria-labelledby")) ===
        (await selectedTab().getAttribute("id")),
    "One tab stop and the correct panel label follow selection",
  );
  await page.locator("#reader-tabs [data-tab]").first().click();
  check(
    await selectedTab().evaluate((el) => el === document.activeElement),
    "Clicking a tab keeps it ready for keyboard navigation",
  );
  checks.push("Source tabs retain scroll, roving focus and panel labels");
  check(errors.length === 0, `No browser exceptions: ${errors.join("; ")}`);
  console.log(
    JSON.stringify({ backend, skipBrain, checks, failures, errors }, null, 2),
  );
  assert.deepEqual(failures, [], "Floating-panel regression failures");
} finally {
  await browser.close();
}
