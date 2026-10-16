/** Curated measurement units, statistic semantics and source provenance. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clockPeriod,
  durationPosition,
  formatDuration,
  timingPanel,
} from "../public/timescales-view.js";

const catalog = JSON.parse(
  readFileSync(new URL("../public/timescales.json", import.meta.url)),
);
let checks = 0;
function check(value, message) {
  assert.ok(value, message);
  checks++;
}
function nonempty(value, label) {
  check(typeof value === "string" && value.trim().length > 0, label);
}
function sources(ids, label) {
  check(Array.isArray(ids) && ids.length > 0, `${label}: source references`);
  check(new Set(ids).size === ids.length, `${label}: unique references`);
  for (const id of ids)
    check(Object.hasOwn(catalog.sources, id), `${label}: resolves ${id}`);
}

check(catalog.schema_version === 1, "Known timescales schema");
check(catalog.units === "seconds", "All numerical times use seconds");
check(catalog.axis === "logarithmic", "Axis measures orders of magnitude");
check(/^\d{4}-\d{2}-\d{2}$/.test(catalog.checked_on), "Research review date");
for (const key of ["title", "intro", "comparisonLimit", "clockRule"])
  nonempty(catalog[key], key);
check(catalog.measurements.length === 4, "Four scoped biological measurements");
check(catalog.parts.length >= 3, "Mechanism analogies include their limits");
const ids = new Set();
for (const row of catalog.measurements) {
  check(/^[a-z][a-z0-9-]*$/.test(row.id), "Stable measurement ID");
  check(!ids.has(row.id), `${row.id}: unique measurement`);
  ids.add(row.id);
  for (const key of [
    "label",
    "displayValue",
    "context",
    "interpretation",
    "species",
  ])
    nonempty(row[key], `${row.id}: ${key}`);
  for (const key of ["minSeconds", "maxSeconds"])
    check(
      Number.isFinite(row[key]) && row[key] > 0,
      `${row.id}: positive finite ${key}`,
    );
  check(row.minSeconds <= row.maxSeconds, `${row.id}: ordered interval`);
  check(
    ["mean", "observed-range", "approximate-onset"].includes(row.statistic),
    `${row.id}: statistic type`,
  );
  if (row.statistic === "observed-range")
    check(
      row.minSeconds < row.maxSeconds,
      `${row.id}: observed range has width`,
    );
  else
    check(
      row.minSeconds === row.maxSeconds,
      `${row.id}: mean/onset is a point, not an invented range`,
    );
  sources(row.sourceIds, row.id);
}

// Independently transcribed paper values in milliseconds: guard the 1000×
// unit error and distinguish SD/SEM from an actually reported min–max range.
const published = [
  ["human-synaptic-onset", 0.91, 0.91, "mean", "molnar-2008"],
  ["human-spike-width", 1.1, 1.1, "mean", "testa-silva-2010"],
  ["human-local-sequence", 5, 65, "observed-range", "molnar-2008"],
  ["human-visual-erp", 150, 150, "approximate-onset", "thorpe-1996"],
];
for (const [id, minimumMs, maximumMs, statistic, sourceId] of published) {
  const row = catalog.measurements.find((entry) => entry.id === id);
  check(row, `${id}: published measurement present`);
  check(
    Math.abs(row.minSeconds * 1000 - minimumMs) < 1e-12,
    `${id}: minimum converts from published ms`,
  );
  check(
    Math.abs(row.maxSeconds * 1000 - maximumMs) < 1e-12,
    `${id}: maximum converts from published ms`,
  );
  check(row.statistic === statistic, `${id}: correct statistic semantics`);
  check(
    row.species === "human",
    `${id}: human study, not an unmarked animal preparation`,
  );
  check(row.sourceIds.includes(sourceId), `${id}: exact primary evidence`);
}
const byId = Object.fromEntries(
  catalog.measurements.map((row) => [row.id, row]),
);
check(
  /38/.test(byId["human-synaptic-onset"].context) &&
    /SD/.test(byId["human-synaptic-onset"].context),
  "Synaptic latency retains sample size and SD",
);
check(
  /9 hippocampal/.test(byId["human-spike-width"].context) &&
    /SEM/.test(byId["human-spike-width"].context),
  "Spike-width mean retains sample size and SEM",
);
check(
  /epilepsy surgery/.test(byId["human-spike-width"].context),
  "Clinical tissue provenance remains visible",
);
check(
  /no-go/.test(byId["human-visual-erp"].context) &&
    /reaction time/.test(byId["human-visual-erp"].interpretation),
  "ERP scope remains distinct from behavioral reaction time",
);
for (const row of catalog.parts) {
  for (const key of ["label", "silicon", "brain", "limit"])
    nonempty(row[key], `Analogy: ${key}`);
  sources(row.sourceIds, row.label);
}
const used = new Set([
  ...catalog.measurements.flatMap((row) => row.sourceIds),
  ...catalog.parts.flatMap((row) => row.sourceIds),
]);
for (const [id, source] of Object.entries(catalog.sources)) {
  check(used.has(id), `${id}: source supports displayed content`);
  for (const key of ["title", "authors", "locator", "scope"])
    nonempty(source[key], `${id}: ${key}`);
  const url = new URL(source.url);
  check(
    url.protocol === "https:" && !url.username && !url.password,
    `${id}: public HTTPS source`,
  );
  check(!url.searchParams.has("q"), `${id}: direct source, not search results`);
}
for (const [seconds, display] of [
  [1e-10, "0.1 ns"],
  [1e-9, "1 ns"],
  [1e-6, "1 µs"],
  [0.00091, "910 µs"],
  [0.0011, "1.1 ms"],
  [0.15, "150 ms"],
  [1, "1 s"],
])
  check(
    formatDuration(seconds) === display,
    `${seconds}: readable duration with correct unit`,
  );
for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
  assert.throws(() => formatDuration(invalid), RangeError);
  assert.throws(() => durationPosition(invalid), RangeError);
  checks += 2;
}
for (const [seconds, percent] of [
  [1e-10, 0],
  [1e-9, 10],
  [1e-6, 40],
  [1e-3, 70],
  [1, 100],
])
  check(
    Math.abs(durationPosition(seconds) - percent) < 1e-9,
    `${seconds}: correct logarithmic axis position`,
  );
check(
  clockPeriod({ kind: "clock", hz: 4.3e9 }) === 1 / 4.3e9,
  "Frequency is inverted only for clock records",
);
for (const timing of [
  null,
  {},
  { kind: "clock", hz: 0 },
  { kind: "clock", hz: -1 },
  { kind: "clock", hz: Infinity },
  { kind: "clock", hz: NaN },
  { kind: "bandwidth", bytesPerSecond: 3.35e12, hz: 4.3e9 },
  { kind: "throughput", bitsPerSecond: 51.2e12, hz: 4.3e9 },
])
  check(
    clockPeriod(timing) === null,
    "Missing/invalid/non-clock values cannot become durations",
  );
const malicious = structuredClone(catalog);
malicious.title = '<img src=x onerror="alert(1)">';
const markup = timingPanel(malicious, { name: "Test", timing: null }, () => "");
check(!markup.includes("<img"), "Evidence text is escaped in panel markup");
console.log(
  `Timescales: ${checks} checks passed; 4 human measurements and 3 bounded analogies.`,
);
