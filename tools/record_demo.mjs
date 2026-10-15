// Record the real local app; raw footage and edit timestamps stay outside Git.
// Run with a local server on :4173, Node >=18, Playwright and Chrome installed.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out = path.resolve('test-results/demo');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'],
});
let context;
try {
  context = await browser.newContext({
    viewport: { width: 1280, height: 840 }, deviceScaleFactor: 1,
    recordVideo: { dir: out, size: { width: 1280, height: 840 } },
  });
  const started = Date.now();
  const p = await context.newPage();
  const video = p.video();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const base = process.env.DOKE_URL || 'http://127.0.0.1:4173';
  await p.goto(base);
  await p.waitForFunction(() => document.documentElement.dataset.ready === 'true', null, { timeout: 90000 });
  await p.evaluate(() => document.fonts.ready);
  assert.equal(await p.title(), 'doke');
  // A recorder-style pointer overlay; it does not change application behavior.
  await p.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.id = 'recording-cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;width:18px;height:24px;pointer-events:none;filter:drop-shadow(0 1px 2px #000);transform:translate(-40px,-40px)';
    cursor.innerHTML = '<svg viewBox="0 0 18 24"><path d="M1 1v18l4-4 4 8 4-2-4-8h7Z" fill="white" stroke="#111" stroke-width="1.3"/></svg>';
    document.body.append(cursor);
    document.addEventListener('pointermove', e => cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`);
  });
  let mouse = [1090, 710];
  const wait = ms => p.waitForTimeout(ms);
  async function move(x, y, ms = 220) {
    const from = mouse, steps = Math.max(1, Math.round(ms / 20));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, eased = t * t * (3 - 2 * t);
      await p.mouse.move(from[0] + (x - from[0]) * eased, from[1] + (y - from[1]) * eased);
      await wait(ms / steps);
    }
    mouse = [x, y];
  }
  async function click(selector) {
    const el = p.locator(selector);
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    assert.ok(box, selector);
    await move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down(); await wait(70); await p.mouse.up();
  }
  async function drag(x, y, dx, dy, ms = 1300) {
    await move(x, y); await p.mouse.down(); await move(x + dx, y + dy, ms); await p.mouse.up();
  }
  async function scene(name) {
    await click(`#scene-navigation [data-scene="${name}"]`);
    await wait(350);
  }
  // Warm the highest anatomy tier and molecular data before the edited tour.
  await click('#settings-button');
  await p.locator('#light-mode').selectOption('sdr');
  await p.locator('#quality').selectOption('high');
  await p.waitForFunction(() => document.querySelector('#load-progress').hidden, null, { timeout: 180000 });
  assert.match(await p.locator('#render-stats').textContent(), /5,080,888/);
  await click('#settings-button');
  for (const id of ['dopamine', 'glutamate']) await p.request.get(`${base}/assets/molecules/${id}.json`);
  await p.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
  await wait(400);
  const segments = [];
  async function clip(title, seconds, action = async () => {}) {
    await wait(160);
    const start = (Date.now() - started) / 1000;
    await action();
    const elapsed = (Date.now() - started) / 1000 - start;
    if (elapsed < seconds) await wait((seconds - elapsed) * 1000);
    const end = (Date.now() - started) / 1000;
    segments.push({ title, start, end });
    await p.screenshot({path:path.join(out, `chapter-${String(segments.length).padStart(2,'0')}.png`)});
    console.log(title, (end - start).toFixed(2), 's');
  }
  await clip('Explore reference anatomy', 2.7, () => drag(820, 395, -130, 35));
  await click('.explorer-dock [data-tab="explore"]');
  await p.locator('#region-search').fill('thalamus');
  await clip('Select a region. Uncover its role.', 2.3, async () => {
    await click('#region-list [data-region="thalamus"]');
    await move(1090, 650); await wait(300);
  });
  await click('.explorer-dock [data-tab="activities"]');
  await click('.activity-card[data-activity="music"]');
  await p.locator('#playhead').fill('32');
  await click('#close-panel');
  await clip('Follow an activity through the brain', 3, async () => {
    await click('#play'); await move(1090, 650);
  });
  await click('#play');
  await scene('atlas');
  await click('#neuron-layer');
  await clip('Discover neurons and synaptic contacts', 2.5, async () => {
    await click('[data-neuron-focus]'); await move(1110, 630);
  });
  await scene('synapse');
  await click('#micro-steps [data-step="1"]');
  await clip('Watch chemical signaling across a synapse', 3, async () => {
    await wait(900); await click('#focus-cleft'); await move(1120, 630);
  });
  await scene('circuit');
  await clip('Experiment with excitation and inhibition', 2.7, async () => {
    await click('#stimulate-circuit'); await move(1100, 640);
  });
  await scene('molecule');
  await p.waitForFunction(() => document.querySelectorAll('.atom-label').length > 5);
  await clip('Meet the molecular messengers', 2.7, async () => {
    await drag(860, 395, 80, 45, 800);
    await click('[data-molecule="glutamate"]'); await move(1110, 640);
  });
  await scene('atlas');
  if (await p.locator('#neuron-layer').getAttribute('aria-pressed') === 'true') await click('#neuron-layer');
  await click('#about-button');
  await p.locator('#details [data-source="allen"]').scrollIntoViewIfNeeded();
  await clip('Follow the evidence. Keep your place.', 3.3, async () => {
    await click('#details [data-source="allen"]');
    await wait(1100);
    await click('[data-panel-page="about"]');
    await p.locator('#details').evaluate(e => e.scrollTop = 0);
    await move(1120, 640);
  });
  await click('#close-panel');
  await click('#reset-view');
  await clip('doke — a window into the brain', 1.4, () => move(1170, 700));
  assert.deepEqual(errors, []);
  const elapsed = (Date.now() - started) / 1000;
  await context.close(); context = null;
  await video.saveAs(path.join(out,'raw.webm'));
  fs.writeFileSync(path.join(out,'edit.json'), JSON.stringify({ viewport: {width:1280,height:840}, segments, elapsed, errors },null,2));
  console.log('Saved recording and edit timestamps in test-results/demo/.');
} finally {
  if (context) await context.close();
  await browser.close();
}
