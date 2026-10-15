import { chromium } from "playwright";
const b = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--use-angle=metal"],
});
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on("pageerror", (e) => console.log("ERROR", e.message));
  p.on("console", (m) => {
    if (m.type() === "error") console.log("GPU", m.text());
  });
  await p.goto("http://127.0.0.1:4173");
  await p.waitForFunction(
    () => document.documentElement.dataset.ready === "true",
    null,
    { timeout: 60000 },
  );
  console.log(await p.locator("#render-stats").textContent());
  await p.waitForTimeout(1000);
  await p.screenshot({ path: "test-results/v03-home.png" });
  await p.locator("#neuron-layer").click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: "test-results/v03-tissue.png" });
  for (const scene of ["synapse", "molecule", "circuit"]) {
    await p.locator(`#scene-navigation [data-scene="${scene}"]`).click();
    await p.waitForTimeout(1000);
    await p.screenshot({ path: `test-results/v03-${scene}.png` });
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator('#scene-navigation [data-scene="synapse"]').click();
  await p.waitForTimeout(900);
  await p.screenshot({ path: "test-results/v03-mobile.png" });
} finally {
  await b.close();
}
