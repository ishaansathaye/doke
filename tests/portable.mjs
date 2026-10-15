import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve("dist/doke"),
  errors = [];
const headers = fs
  .readFileSync(path.join(root, "_headers"), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("  "))
  .map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/doke/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const p = path.join(
    root,
    decodeURIComponent(url.pathname.slice(6)) || "index.html",
  );
  if (!p.startsWith(root) || !fs.existsSync(p)) {
    res.writeHead(404);
    res.end();
    return;
  }
  for (const [k, v] of headers) res.setHeader(k, v);
  res.setHeader(
    "Content-Type",
    {
      ".wasm": "application/wasm",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".html": "text/html",
      ".ttf": "font/ttf",
    }[path.extname(p)] || "application/octet-stream",
  );
  res.end(fs.readFileSync(p));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/doke/`;
const b = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
try {
  const p = await b.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await p.goto(base);
  await p.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 90000 },
  );
  assert.match(await p.locator("#render-stats").textContent(), /BrowserWebGpu/);
  await p.locator('#scene-navigation [data-scene="experiment"]').click();
  await p.locator('[data-experiment-action="probe"]').click();
  await p.waitForFunction(() =>
    document
      .querySelector('[data-cue-response="0"]')
      .textContent.includes("no spike"),
  );
  assert.match(await p.locator('[data-cue-weight="0"]').textContent(), /0\.32/);
  await p.locator('#scene-navigation [data-scene="synapse"]').click();
  await p.locator("#inspect-molecule").click();
  await p.waitForFunction(
    () => document.querySelectorAll(".atom-label").length > 5,
  );
  await p.locator('#scene-navigation [data-scene="atlas"]').click();
  await p.locator("#settings-button").click();
  await p.locator("#quality").selectOption("fine");
  await p.waitForFunction(
    () => document.querySelector("#load-progress").hidden,
    null,
    { timeout: 180000 },
  );
  assert.match(await p.locator("#render-stats").textContent(), /2,100,796/);
  assert.deepEqual(errors, []);
  const report = {
    status: "passed",
    subdirectory: "/doke/",
    csp: "Cloudflare _headers applied by local test server",
    errors,
  };
  fs.writeFileSync(
    "test-results/portable-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await b.close();
  server.close();
}
