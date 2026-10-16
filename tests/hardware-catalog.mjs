import fs from "node:fs";
import assert from "node:assert/strict";
const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
const catalog = read("public/hardware.json");
const comparison = read("public/comparison.json");
const atlas = read("public/assets/atlas.json");
const seen = new Set();
for (const p of catalog.profiles) {
  assert.ok(!seen.has(p.id), `Duplicate profile ${p.id}`);
  seen.add(p.id);
  assert.ok(["cpu", "gpu", "npu", "asic"].includes(p.family));
  assert.ok(p.limits.length, `${p.id} must state model limits`);
  const sources = new Set(p.sources.map((s) => s.id));
  assert.equal(sources.size, p.sources.length);
  for (const s of p.sources) {
    assert.equal(new URL(s.url).protocol, "https:");
    assert.match(s.checked, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const f of p.facts) {
    assert.ok(sources.has(f.source), `${p.id}: unresolved source ${f.source}`);
    assert.ok(f.locator && f.value && f.label);
  }
}
assert.ok(catalog.profiles.some((p) => p.family === "asic"));
assert.ok(catalog.profiles.some((p) => p.family === "npu"));
let end = 0;
for (const stage of comparison.brain.stages) {
  assert.equal(stage.startSeconds, end);
  assert.ok(stage.endSeconds > end);
  end = stage.endSeconds;
  for (const r of stage.regions)
    assert.ok(
      atlas.regions.some((a) => a.id === r),
      `Unknown anatomy ${r}`,
    );
  for (const id of stage.sources)
    assert.ok(comparison.sources[id], `Unknown evidence ${id}`);
}
assert.equal(end, comparison.brain.durationSeconds);
for (const s of Object.values(comparison.sources)) {
  assert.equal(new URL(s.url).protocol, "https:");
  assert.ok(s.finding && s.limit);
}
console.log(
  `${catalog.profiles.length} sourced profiles; ${comparison.brain.stages.length} atlas-linked guide stages; references and units retained.`,
);
