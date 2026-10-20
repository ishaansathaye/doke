/** Verify gestures against the real renderer's projected coordinates. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { wheelZoom } from "../public/camera-controls.js";

assert.equal(
  wheelZoom({ deltaY: 48, deltaMode: 0 }, 800),
  wheelZoom({ deltaY: 3, deltaMode: 1 }, 800),
  "Line and pixel wheel units describe the same zoom",
);
assert.equal(
  wheelZoom({ deltaY: 80, deltaMode: 0 }, 800),
  wheelZoom({ deltaY: 0.1, deltaMode: 2 }, 800),
  "Page and pixel wheel units describe the same zoom",
);
assert.ok(wheelZoom({ deltaY: -4, deltaMode: 0, ctrlKey: true }, 800) < 0);
assert.equal(wheelZoom({ deltaY: NaN, deltaMode: 0 }, 800), 0);

const isMac = process.platform === "darwin";
const skipBrain = process.env.DOKE_SKIP_BRAIN === "1";
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
page.on("pageerror", (error) => errors.push(error.message));
const state = (brain, anchor = [0, 0, 0]) =>
  page.evaluate(
    ({ brain, anchor }) => {
      const renderer = brain
        ? window.dokeBrainComparison.getRenderer()
        : window.dokeFocused.getRenderer();
      renderer.render(0);
      const canvas = document.querySelector(
        brain ? "#brain-canvas" : "#chip-canvas",
      );
      const rect = canvas.getBoundingClientRect();
      const project = (p) => {
        const v = renderer.project(...p);
        return [
          (v[0] * rect.width) / canvas.width,
          (v[1] * rect.height) / canvas.height,
        ];
      };
      const pose = [...renderer.camera_state()];
      return {
        pose,
        center: project([0, 0, 0]),
        focal: project(pose.slice(3)),
        anchor: project(anchor),
        front: project([0, 0, 0.4]),
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    },
    { brain, anchor },
  );
const reset = (brain) =>
  page.evaluate((brain) => {
    const renderer = brain
      ? window.dokeBrainComparison.getRenderer()
      : window.dokeFocused.getRenderer();
    if (brain) {
      window.dokeBrainComparison.resetView();
      const [, yaw, pitch] = renderer.camera_state();
      renderer.orbit(-yaw, -pitch);
      window.dokeBrainComparison.cameraChanged();
    } else renderer.chip_camera(8, 0, 0, 0, 0, 0);
    renderer.render(0);
  }, brain);
async function drag(brain, dx, dy, button = "left", shift = false) {
  const { bounds } = await state(brain);
  const x = bounds.x + bounds.width * 0.55;
  const y = bounds.y + bounds.height * 0.53;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up({ button });
  if (shift) await page.keyboard.up("Shift");
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
  const checks = [];
  for (const brain of skipBrain ? [false] : [false, true]) {
    const name = brain ? "brain" : "chip";
    if (brain) {
      await page.locator('[data-world="brain"]').click();
      await page.waitForFunction(
        () => window.dokeBrainComparison?.snapshot().ready,
        null,
        { timeout: 90000 },
      );
    }
    await reset(brain);
    let before = await state(brain);
    await drag(brain, 50, 0);
    let after = await state(brain);
    assert.ok(
      after.front[0] > before.front[0] + 2,
      `${name}: front surface follows a rightward orbit gesture`,
    );
    assert.equal(after.pose[0], before.pose[0], "Orbit preserves zoom");

    for (const [button, shift] of [
      ["left", true],
      ["right", false],
    ]) {
      await reset(brain);
      // Tilt the camera: using world-Y would produce a diagonal/slow pan here.
      await page.evaluate((brain) => {
        const renderer = brain
          ? window.dokeBrainComparison.getRenderer()
          : window.dokeFocused.getRenderer();
        renderer.orbit(0.7, 0.85);
        renderer.render(0);
      }, brain);
      before = await state(brain);
      await drag(brain, -64, 40, button, shift);
      after = await state(brain, before.pose.slice(3));
      assert.ok(
        Math.abs(after.anchor[0] - before.focal[0] + 64) < 1,
        `${name}: leftward pan follows 64 CSS pixels at a tilted view`,
      );
      assert.ok(
        Math.abs(after.anchor[1] - before.focal[1] - 40) < 1,
        `${name}: downward pan follows 40 CSS pixels without drift`,
      );
      assert.deepEqual(after.pose.slice(0, 3), before.pose.slice(0, 3));
    }
    await reset(brain);
    before = await state(brain);
    await page.locator(brain ? "#brain-canvas" : "#chip-canvas").focus();
    await page.keyboard.press("+");
    after = await state(brain);
    assert.ok(after.pose[0] < before.pose[0], `${name}: plus zooms in`);
    await page.keyboard.press("-");
    assert.ok(Math.abs((await state(brain)).pose[0] - before.pose[0]) < 0.001);
    await page.keyboard.press("Shift+ArrowLeft");
    after = await state(brain);
    assert.ok(Math.abs(after.center[0] - before.center[0] + 24) < 1);
    await reset(brain);
    before = await state(brain);
    const { bounds } = before;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(80);
    after = await state(brain);
    assert.ok(after.pose[0] < before.pose[0], `${name}: scroll up zooms in`);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(80);
    assert.ok(Math.abs((await state(brain)).pose[0] - before.pose[0]) < 0.001);
    // An off-center focal-plane point stays under the cursor during zoom.
    await reset(brain);
    before = await state(brain);
    const anchor = before.pose.slice(3).map((v, i) => v + [0.3, 0.2, 0][i]);
    before = await state(brain, anchor);
    await page.mouse.move(
      before.bounds.x + before.anchor[0],
      before.bounds.y + before.anchor[1],
    );
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(80);
    after = await state(brain, anchor);
    assert.ok(
      Math.hypot(
        after.anchor[0] - before.anchor[0],
        after.anchor[1] - before.anchor[1],
      ) < 1,
      `${name}: wheel zoom keeps the focal point under the cursor`,
    );
    before = await state(brain);
    await page.mouse.wheel(48, 0);
    await page.waitForTimeout(80);
    after = await state(brain, before.pose.slice(3));
    assert.ok(
      Math.abs(after.anchor[0] - before.focal[0] + 48) < 1,
      `${name}: horizontal trackpad scrolling pans`,
    );
    assert.equal(
      after.pose[0],
      before.pose[0],
      `${name}: horizontal scrolling does not zoom`,
    );
    before = await state(brain);
    await page
      .locator(brain ? "#brain-canvas" : "#chip-canvas")
      .evaluate((canvas) => {
        // Some Safari GestureEvents omit coordinates; retain the last pointer.
        for (const [type, scale] of [
          ["gesturestart", 1],
          ["gesturechange", 1.25],
          ["gestureend", 1.25],
        ]) {
          const event = new Event(type, { cancelable: true });
          Object.defineProperty(event, "scale", { value: scale });
          canvas.dispatchEvent(event);
        }
      });
    after = await state(brain);
    assert.ok(
      Math.abs(after.pose[0] / before.pose[0] - 0.8) < 0.001,
      `${name}: Safari gesture event fallback zooms without coordinates`,
    );
    checks.push(
      `${name}: orbit direction, perspective-correct pan, wheel and keyboard zoom`,
    );
  }

  // Real touch delivery checks pinch, centroid pan, one-finger continuation,
  // and cancellation. A cancelled gesture must never become a region click.
  const session = await page.context().newCDPSession(page);
  const touchBrain = !skipBrain;
  const touchCanvas = touchBrain ? "#brain-canvas" : "#chip-canvas";
  await reset(touchBrain);
  const initial = await state(touchBrain);
  const anchor = initial.pose.slice(3).map((v, i) => v + [0.3, 0.2, 0][i]);
  const before = await state(touchBrain, anchor);
  const { bounds } = before;
  const cx = bounds.x + before.anchor[0],
    cy = bounds.y + before.anchor[1];
  const touches = (x, spread, y = cy) => [
    { x: x - spread, y, id: 1 },
    { x: x + spread, y, id: 2 },
  ];
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touches(cx, 60),
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: touches(cx - 30, 90, cy + 20),
  });
  const pinched = await state(touchBrain, anchor);
  assert.ok(
    pinched.pose[0] < before.pose[0],
    "Two fingers apart zoom into the scene",
  );
  assert.ok(
    Math.abs(pinched.anchor[0] - before.anchor[0] + 30) < 2,
    "Two-finger pan follows a leftward gesture",
  );
  assert.ok(
    Math.abs(pinched.anchor[1] - before.anchor[1] - 20) < 2,
    "Two-finger pan follows a downward gesture",
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [{ x: cx - 120, y: cy + 20, id: 1 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: cx + 70, y: cy + 20, id: 2 }],
  });
  await page.waitForTimeout(50);
  const continued = await state(touchBrain);
  assert.ok(
    Math.abs(continued.pose[1] - pinched.pose[1] + 0.05) < 0.005,
    `Lifting one finger continues without a camera jump (${pinched.pose[1]} → ${continued.pose[1]})`,
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  assert.equal(
    await page.locator(touchCanvas).getAttribute("data-dragging"),
    null,
  );
  assert.equal(await page.locator("#reader").isVisible(), false);
  await session.detach();
  checks.push(
    "Touch pinch/pan, two-to-one-finger continuation and cancellation",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
