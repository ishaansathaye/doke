import { chromium } from "playwright";
import fs from "node:fs";
fs.mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
page.on("console", (m) => console.log(m.type() + ": " + m.text()));
page.on("pageerror", (e) => console.log("PAGE ERROR: " + e.message));
await page.goto("http://127.0.0.1:4173/");
await page.waitForFunction(
  () => document.documentElement.dataset.ready === "true",
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(500);
await page.screenshot({ path: "test-results/preview.png" });
console.log(await page.locator("#render-stats").textContent());
await browser.close();
