/** Exercise the packaged app beneath a project path and its real CSP. */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve("dist/doke");
const errors = [],
  checks = [];
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "release.json"), "utf8"),
);
for (const required of [
  "index.html",
  "silicon.js",
  "silicon.css",
  "architecture.json",
  "brain.json",
  "comparison.json",
  "pkg/doke_bg.wasm",
  "assets/brain.bin",
  "assets/fine/manifest.json",
]) {
  assert.ok(manifest.files[required], `Portable artifact includes ${required}`);
}
assert.ok(
  !Object.keys(manifest.files).some(
    (file) =>
      /^(app\.js|style\.css|content\.json)$/.test(file) ||
      file.startsWith("assets/molecules/"),
  ),
  "Removed scenes are absent from the published artifact",
);
checks.push("current runtime assets and no obsolete chemistry interface");

const headers = fs
  .readFileSync(path.join(root, "_headers"), "utf8")
  .split("\n")
  .filter((line) => line.startsWith("  "))
  .map((line) => {
    const colon = line.indexOf(":");
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  });
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith("/doke/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  const file = path.resolve(
    root,
    decodeURIComponent(url.pathname.slice(6)) || "index.html",
  );
  const relative = path.relative(root, file);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    response.writeHead(404);
    response.end();
    return;
  }
  for (const [key, value] of headers) response.setHeader(key, value);
  response.setHeader(
    "Content-Type",
    {
      ".wasm": "application/wasm",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".html": "text/html",
      ".ttf": "font/ttf",
      ".svg": "image/svg+xml",
    }[path.extname(file)] || "application/octet-stream",
  );
  response.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const isMac = process.platform === "darwin";
const backend = process.env.DOKE_BACKEND || (isMac ? "webgpu" : "webgl");
const base = `http://127.0.0.1:${server.address().port}/doke/`;
let browser;
try {
  browser = await chromium.launch({
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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  const response = await page.goto(`${base}?backend=${backend}`);
  assert.match(
    response.headers()["content-security-policy"],
    /wasm-unsafe-eval/,
  );
  async function ready() {
    await page.waitForFunction(
      () => window.dokeFocused?.getState().rendererReady,
      null,
      { timeout: 90000 },
    );
    assert.equal(await page.title(), "doke");
  }
  await ready();
  assert.match(
    await page.locator("#render-status").textContent(),
    backend === "webgl" ? /\bGl\b/ : /BrowserWebGpu/,
  );
  assert.deepEqual(await page.locator(".worlds button").allTextContents(), [
    "CPU",
    "GPU",
    "Human brain",
  ]);
  for (const family of ["gpu", "cpu"]) {
    await page.locator(`button[data-world="${family}"]`).click();
    for (const level of ["processor", "core", "execution"]) {
      await page.locator(`button[data-level="${level}"]`).click();
      assert.equal(
        await page.evaluate(() => window.dokeFocused.getState().level),
        level,
      );
    }
    const input = await page.evaluate(() => window.dokeFocused.input());
    const expected = input.map(
      (value, index) => value - (index % 8 ? input[index - 1] : 0),
    );
    const final = await page.evaluate(() => window.dokeFocused.finish());
    assert.equal(final.status, "complete");
    assert.deepEqual(final.output, expected);
    assert.equal(
      final.detail.outputs.reduce(
        (sum, output) => sum + output.retired_terms,
        0,
      ),
      512,
    );
  }
  checks.push(
    "CPU/GPU processor, core and execution views with exact arithmetic",
  );
  await page.locator('button[data-world="brain"]').click();
  await page.waitForFunction(
    () => window.dokeBrainComparison?.snapshot().ready,
    null,
    { timeout: 90000 },
  );
  const brain = await page.evaluate(() =>
    window.dokeBrainComparison.snapshot(),
  );
  assert.equal(brain.error, null);
  assert.equal(brain.backend, backend === "webgl" ? "Gl" : "BrowserWebGpu");
  assert.equal(
    await page.evaluate(
      () => window.dokeBrainComparison.getAtlas().regions.length,
    ),
    37,
  );
  await page.locator("#settings-toggle").click();
  await page.locator("#brain-quality").selectOption("fine");
  await page.waitForFunction(
    () => {
      const brain = window.dokeBrainComparison.snapshot();
      return brain.quality === "fine" && !brain.qualityLoading;
    },
    null,
    { timeout: 180000 },
  );
  assert.equal(
    await page.evaluate(
      () => window.dokeBrainComparison.snapshot().qualityError,
    ),
    null,
  );
  await page.locator("#settings-toggle").click();
  checks.push(
    "actual reference atlas and fine chunked mesh under project path",
  );
  await page.locator('button[data-world="gpu"]').click();
  await page.locator("#compare-toggle").click();
  await page.waitForFunction(
    () =>
      window.dokeFocused.getState().comparing &&
      window.dokeBrainComparison.snapshot().ready,
  );
  const before = await page.evaluate(() => window.dokeFocused.snapshot().tick);
  await page.locator("#brain-guide-next").click();
  assert.equal(
    await page.evaluate(() => window.dokeBrainComparison.snapshot().time),
    4,
  );
  assert.equal(
    await page.evaluate(() => window.dokeFocused.snapshot().tick),
    before,
  );
  checks.push("brain comparison has an independent guide clock");
  await page.goto(`${base}silicon.html?compare=1&backend=${backend}`);
  await ready();
  await page.waitForFunction(
    () =>
      window.dokeFocused.getState().comparing &&
      window.dokeBrainComparison?.snapshot().ready,
    null,
    { timeout: 90000 },
  );
  assert.equal(new URL(page.url()).pathname, "/doke/");
  checks.push(
    "legacy review links retain comparison and project-relative assets",
  );
  assert.deepEqual(errors, []);
  const report = {
    status: "passed",
    subdirectory: "/doke/",
    backend,
    csp: "Packaged Cloudflare headers applied",
    checks,
    errors,
  };
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(
    "test-results/portable-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
