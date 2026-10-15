import { chromium } from "playwright";
const b = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
p.on("pageerror", (e) => console.log("ERROR", e.message));
p.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
await p.goto("http://127.0.0.1:4173/");
await p.waitForFunction(
  () => document.documentElement.dataset.ready === "true",
);
for (const scene of ["synapse", "circuit"]) {
  await p.locator(`#scene-navigation [data-scene="${scene}"]`).click();
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `test-results/doke-${scene}.png` });
}
await p.locator('#scene-navigation [data-scene="synapse"]').click();
await p.locator("#inspect-molecule").click();
await p.waitForTimeout(500);
await p.screenshot({ path: "test-results/doke-molecule.png" });
await p.locator('#scene-navigation [data-scene="atlas"]').click();
await p.locator("#settings-button").click();
await p.locator("#quality").selectOption("high");
await p.waitForFunction(
  () => document.querySelector("#load-progress").hidden,
  null,
  { timeout: 180000 },
);
console.log("native", await p.locator("#render-stats").textContent());
await p.locator("#settings-button").click();
await p.screenshot({ path: "test-results/doke-native.png" });
console.log(
  "display",
  await p.evaluate(() => ({
    hdr: matchMedia("(dynamic-range: high)").matches,
    config: document
      .querySelector("#brain-canvas")
      .getContext("webgpu")
      .getConfiguration().toneMapping,
  })),
);
await b.close();
