import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve("docs/play/mocks");
const out = "test-results/play";
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  const file = path.resolve(root, `.${name === "/" ? "/index.html" : name}`);
  if (
    !file.startsWith(root + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    file.endsWith(".html")
      ? "text/html"
      : file.endsWith(".webp")
        ? "image/webp"
        : "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : process.platform === "darwin"
      ? {
          executablePath:
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        }
      : {}),
});
const errors = [],
  results = [];
async function page(
  name,
  viewport = { width: 1440, height: 1000 },
  reducedMotion = "no-preference",
) {
  const p = await browser.newPage({ viewport, reducedMotion });
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
  });
  p.on("request", (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith("data:"))
      errors.push(`Unexpected external request: ${r.url()}`);
  });
  await p.goto(`${base}/${name}.html`);
  await p.waitForTimeout(150);
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    `${name} horizontal overflow`,
  );
  return p;
}
async function inView(p, selectors) {
  const { width, height } = p.viewportSize();
  for (const selector of selectors) {
    const b = await p.locator(selector).boundingBox();
    assert.ok(
      b &&
        b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= width + 1 &&
        b.y + b.height <= height + 1,
      `${selector} outside ${width}×${height}`,
    );
  }
}
try {
  const p = await page("body");
  await p.locator("#bread").click();
  await p.locator("#coffee").click();
  assert.deepEqual(await p.evaluate(() => mockState().additions), [
    "bread",
    "coffee",
  ]);
  const before = await p.evaluate(() => mockState().boli[0].p);
  await p.waitForTimeout(400);
  assert.ok((await p.evaluate(() => mockState().boli[0].p)) > before);
  await p.locator("#pause").click();
  const frozen = await p.evaluate(() => mockState().time);
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => mockState().time), frozen);
  await p.locator("#ripple").click();
  assert.equal(await p.evaluate(() => mockState().waves), 1);
  await p.locator("#gut").click();
  await p.waitForFunction(() => mockState().zoom > 2.5);
  await p.screenshot({ path: `${out}/body-gut.png` });
  await p.locator("#whole").click();
  await p.locator("#replay").click();
  await p.waitForFunction(() => mockState().signalKinds.includes("taste"));
  assert.deepEqual(await p.evaluate(() => mockState().additions), [
    "bread",
    "coffee",
  ]);
  await p.locator("#clear").click();
  assert.equal(await p.evaluate(() => mockState().additions.length), 0);
  const bread = await p.locator("#bread").boundingBox();
  await p.mouse.move(bread.x + bread.width / 2, bread.y + 15);
  await p.mouse.down();
  await p.mouse.move(930, 350, { steps: 12 });
  await p.mouse.up();
  assert.deepEqual(await p.evaluate(() => mockState().additions), ["bread"]);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/body-desktop.png` });
  results.push(
    "Body: sequence, actual transport, immediate pause, wave, zoom, replay, clear, drag input",
  );
  await p.close();

  const c = await page("creature");
  await c.waitForFunction(
    () => +document.querySelector("#world").dataset.eaten > 0,
    null,
    { timeout: 15000 },
  );
  await c.locator("#pause").click();
  await c.waitForFunction(
    () => document.querySelector("#world").dataset.paused === "true",
  );
  const ct = await c.locator("#world").getAttribute("data-sim-time");
  await c.waitForTimeout(250);
  assert.equal(await c.locator("#world").getAttribute("data-sim-time"), ct);
  await c.locator("#clear").click();
  assert.equal(await c.locator("#world").getAttribute("data-food-count"), "0");
  await c.locator('[data-tool="wall"]').click();
  await c.mouse.click(1000, 450);
  assert.ok(+(await c.locator("#world").getAttribute("data-wall-count")) > 0);
  await c.locator('[data-tool="erase"]').click();
  await c.mouse.click(1000, 450);
  assert.equal(await c.locator("#world").getAttribute("data-wall-count"), "0");
  await c.locator("#drop").click();
  assert.ok(+(await c.locator("#world").getAttribute("data-food-count")) > 0);
  await c.locator("#reset").click();
  assert.equal(await c.locator("#world").getAttribute("data-eaten"), "0");
  await c.waitForTimeout(2500);
  await c.screenshot({ path: `${out}/creature-desktop.png` });
  results.push(
    "Creature: actual food consumption, pause, paint/erase barriers, food input, reset",
  );
  await c.close();

  const m = await page("echo");
  await m.locator("#sample").click();
  const lit = +(await m.locator("#field").getAttribute("data-lit"));
  assert.ok(lit > 5);
  await m.locator("#keep").click();
  await m.locator("#scatter").click();
  assert.ok(+(await m.locator("#field").getAttribute("data-lit")) < lit);
  await m.locator("#recall").click();
  await m.waitForFunction(
    () => document.querySelector("#field").dataset.restoring === "false",
  );
  assert.equal(await m.locator("#field").getAttribute("data-match"), "1");
  assert.equal(+(await m.locator("#field").getAttribute("data-lit")), lit);
  await m.screenshot({ path: `${out}/memory-desktop.png` });
  // Holding the same mark twice must expose ambiguity instead of inventing recall.
  await m.locator("#keep").click();
  await m.locator("#scatter").click();
  await m.locator("#recall").click();
  assert.match(await m.locator("#status").textContent(), /Two traces fit/);
  await m.locator("#new").click();
  assert.equal(await m.locator("#recall").isDisabled(), true);
  await m.locator("#field").focus();
  await m.keyboard.press("Space");
  await m.keyboard.press("ArrowRight");
  await m.keyboard.press("Space");
  assert.ok(+(await m.locator("#field").getAttribute("data-lit")) > 0);
  await m.reload();
  assert.equal(await m.locator("#field").getAttribute("data-held"), "0");
  results.push(
    "Memory: retained mark, partial-cue retrieval, ambiguous refusal, empty-cue guard, keyboard drawing, reload clears",
  );
  await m.close();

  for (const [name, selectors] of [
    ["body", ["#bread", "#coffee", "#ripple", "#pause", "#gut"]],
    ["creature", ["#drop", "#pause", "#clear", '[data-tool="wall"]']],
    ["echo", ["#keep", "#scatter", "#recall", "#about-toggle"]],
  ]) {
    for (const height of [844, 700]) {
      const small = await page(name, { width: 390, height }, "reduce");
      await inView(small, selectors);
      if (name === "body") {
        assert.equal(await small.evaluate(() => mockState().paused), true);
        await small.locator("#bread").click();
        assert.equal(
          await small.evaluate(() => mockState().additions.length),
          1,
        );
      } else if (name === "creature") {
        assert.equal(
          await small.locator("#world").getAttribute("data-paused"),
          "true",
        );
        await small.locator("#drop").click();
      } else {
        await small.locator("#about-toggle").click();
        await small.locator("#about-sample").click();
        await small.locator("#keep").click();
        await small.locator("#scatter").click();
        await small.locator("#recall").click();
        assert.match(await small.locator("#status").textContent(), /returned/);
        await small.locator("#about-toggle").click();
        await inView(small, ["#about", "#close-about"]);
        await small.keyboard.press("Escape");
        assert.equal(await small.locator("#about").isVisible(), false);
      }
      await small.screenshot({ path: `${out}/${name}-mobile-${height}.png` });
      await small.close();
    }
  }
  results.push(
    "All three: 390×844 and 390×700, reduced motion, controls in view, no external requests",
  );
  const gallery = await page("index");
  assert.equal(await gallery.locator(".card").count(), 3);
  assert.equal(
    await gallery
      .locator(".visual img")
      .evaluateAll((imgs) =>
        imgs.every((i) => i.complete && i.naturalWidth > 0),
      ),
    true,
  );
  await gallery.screenshot({ path: `${out}/gallery.png`, fullPage: true });
  await gallery.close();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${out}/results.json`,
    JSON.stringify({ status: "passed", results, errors }, null, 2),
  );
  console.log(JSON.stringify({ status: "passed", results, errors }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
