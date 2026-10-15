import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
const b = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const errors = [],
  checks = [];
const base = process.env.DOKE_URL || "http://127.0.0.1:4173";
const hash = (buf) => createHash("sha256").update(buf).digest("hex");
function observe(p) {
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
}
const scene = (p, id) =>
  p.locator(`#scene-navigation [data-scene="${id}"]`).click();
const ready = (p) =>
  p.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 90000 },
  );
async function nonoverlap(p) {
  const result = await p.evaluate(() => {
    const ids = ["info-panel", "view-settings"];
    const visible = ids
      .map((id) => document.getElementById(id))
      .filter((el) => el.checkVisibility());
    const rects = visible.map((el) => ({
      id: el.id,
      r: el.getBoundingClientRect(),
    }));
    return rects.flatMap((a, i) =>
      rects
        .slice(i + 1)
        .filter(
          (c) =>
            a.r.left < c.r.right &&
            a.r.right > c.r.left &&
            a.r.top < c.r.bottom &&
            a.r.bottom > c.r.top,
        )
        .map((c) => `${a.id}/${c.id}`),
    );
  });
  assert.deepEqual(result, []);
}
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  observe(p);
  await p.goto(base);
  await ready(p);
  assert.equal(await p.locator(".hero-copy").count(), 0);
  assert.equal(await p.locator("#scene-navigation button").count(), 4);
  await p.locator('.explorer-dock [data-tab="explore"]').click();
  await p.locator("#region-search").fill("thalamus");
  await p.locator('#region-list [data-region="thalamus"]').click();
  assert.equal(
    await p
      .locator('[data-panel-page="region-thalamus"]')
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await p.locator(".left-panel").isVisible(), false);
  assert.ok((await p.locator("#info-panel").boundingBox()).x < 40);
  await p.locator("#settings-button").click();
  await nonoverlap(p);
  await p.screenshot({ path: "test-results/v03-panels.png" });
  await p.locator('#details [data-source="allen"]').click();
  assert.equal(await p.locator("#info-panel").isVisible(), true);
  await nonoverlap(p);
  assert.equal(
    await p
      .locator('[data-panel-page="source-allen"]')
      .getAttribute("aria-selected"),
    "true",
  );
  await p.locator("#close-tab").click();
  await p.locator("#info-panel").waitFor({ state: "visible" });
  await p.locator("#panel-browse").click();
  assert.equal(await p.locator("#details").isVisible(), false);
  await p.locator("#close-panel").click();
  checks.push(
    "one left panel with exclusive tabs; sources and tools never overlap",
  );
  await scene(p, "atlas");
  await p.locator("#neuron-layer").click();
  assert.equal(
    await p.locator("#neuron-layer").getAttribute("aria-pressed"),
    "true",
  );
  assert.match(await p.locator("#details").textContent(), /not measured/);
  await p.locator("[data-neuron-focus]").click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: "test-results/v03-neuron-close.png" });
  await p.locator("#neuron-layer").click();
  assert.equal(
    await p.locator("#neuron-layer").getAttribute("aria-pressed"),
    "false",
  );
  checks.push(
    "optional localized neurons and synaptic contacts with explicit scale caveat",
  );
  await scene(p, "synapse");
  assert.equal(await p.locator(".explorer-dock").isVisible(), false);
  assert.equal(await p.locator("#micro-controls").isVisible(), true);
  await p.waitForTimeout(1000);
  for (let step = 0; step < 4; step++) {
    await p.locator(`#micro-steps [data-step="${step}"]`).click();
    if (
      (await p.locator("#micro-play").getAttribute("aria-pressed")) === "true"
    )
      await p.locator("#micro-play").click();
    assert.equal(
      await p.locator("#micro-play").getAttribute("aria-pressed"),
      "false",
    );
    await p.waitForTimeout(80);
    const paused = hash(await p.locator("#brain-canvas").screenshot());
    await p.waitForTimeout(160);
    assert.equal(
      hash(await p.locator("#brain-canvas").screenshot()),
      paused,
      `stage ${step} stays paused`,
    );
    const start = Date.now();
    await p.locator("#micro-play").click();
    assert.equal(
      await p.locator("#micro-play").getAttribute("aria-pressed"),
      "true",
    );
    await p.waitForTimeout(120);
    assert.notEqual(
      hash(await p.locator("#brain-canvas").screenshot()),
      paused,
      `stage ${step} resumes visibly`,
    );
    assert.ok(
      Date.now() - start < 1000,
      "resumption does not wait for stage transition",
    );
    await p.locator("#micro-play").click();
  }
  checks.push(
    "all four synapse stages freeze exactly on pause and resume visibly without waiting for transitions",
  );
  await p.locator("#micro-info").click();
  await nonoverlap(p);
  assert.ok((await p.locator("#info-panel").boundingBox()).x < 40);
  await scene(p, "molecule");
  assert.equal(await p.locator("#info-panel").isVisible(), false);
  assert.equal(await p.locator(".explorer-dock").isVisible(), false);
  await p.waitForTimeout(900);
  assert.ok(await p.locator('.atom-label[data-element="O"]').count());
  const colored = hash(await p.locator("#brain-canvas").screenshot());
  await p.locator("#settings-button").click();
  await p.locator("#subtle-colors").uncheck();
  await p.locator("#settings-button").click();
  await p.waitForTimeout(100);
  assert.notEqual(hash(await p.locator("#brain-canvas").screenshot()), colored);
  await p.locator("#settings-button").click();
  await p.locator("#subtle-colors").check();
  await p.locator("#settings-button").click();
  checks.push("Messengers top navigation, atom accents, monochrome option");
  await scene(p, "circuit");
  assert.equal(await p.locator(".explorer-dock").isVisible(), false);
  await p.locator("#circuit-controls").click();
  assert.ok((await p.locator("#info-panel").boundingBox()).x < 40);
  await p.locator('[data-panel-page="region-thalamus"]').click();
  assert.equal(await p.locator(".left-panel").isVisible(), false);
  checks.push("contextual docks for all four scenes");
  for (const width of [390, 820, 1024]) {
    await p.setViewportSize({ width, height: 844 });
    await scene(p, "synapse");
    await p.locator("#micro-info").click();
    await p.locator("#settings-button").click();
    await nonoverlap(p);
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await p.locator("#settings-button").click();
    await p.locator("#micro-info").click();
    await p.screenshot({ path: `test-results/v03-panel-${width}.png` });
  }
  const reduced = await b.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  observe(reduced);
  await reduced.goto(base);
  await ready(reduced);
  await scene(reduced, "synapse");
  assert.equal(
    await reduced.locator("#micro-play").getAttribute("aria-pressed"),
    "false",
  );
  await reduced.locator("#micro-play").click();
  assert.equal(
    await reduced.locator("#micro-play").getAttribute("aria-pressed"),
    "true",
  );
  await reduced.close();
  checks.push(
    "responsive panel geometry; explicit playback works with reduced-motion default",
  );
  const race = await b.newPage();
  observe(race);
  await race.route("**/assets/molecules/dopamine.json", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.continue();
  });
  await race.goto(base);
  await ready(race);
  await scene(race, "molecule");
  await scene(race, "atlas");
  await race.waitForTimeout(700);
  assert.equal(await race.locator("body").getAttribute("data-scene"), "atlas");
  assert.match(await race.locator("#render-stats").textContent(), /270,212/);
  await race.close();
  checks.push("a delayed molecule request cannot overwrite a newer scene");
  const gl = await b.newPage();
  observe(gl);
  await gl.goto(base + "/?backend=webgl");
  await ready(gl);
  assert.match(await gl.locator("#render-stats").textContent(), /Gl/);
  await gl.locator("#neuron-layer").click();
  await gl.waitForTimeout(250);
  await scene(gl, "molecule");
  await gl.waitForTimeout(800);
  await gl.close();
  checks.push("WebGL tissue and colored molecules");
  assert.deepEqual(errors, []);
  const report = {
    status: "passed",
    errors,
    checks,
    date: new Date().toISOString(),
  };
  fs.writeFileSync(
    "test-results/refinement-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await b.close();
}
