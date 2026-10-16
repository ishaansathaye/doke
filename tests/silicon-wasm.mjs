/** Actual generated Wasm boundary checks. Run after: bash tools/build.sh */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initSync,
  SiliconSimulation,
  FabricSimulation,
} from "../public/pkg/doke.js";

initSync({
  module: readFileSync(new URL("../public/pkg/doke_bg.wasm", import.meta.url)),
});

let assertions = 0;
const snapshot = (model) => JSON.parse(model.snapshot());
function rejectsAtomically(model, command, label) {
  const before = snapshot(model);
  assert.throws(command, undefined, `${label} must reject`);
  assert.deepEqual(snapshot(model), before, `${label} must preserve state`);
  assertions += 2;
}
function withModel(model, check) {
  try {
    return check(model);
  } finally {
    model.free();
  }
}
const invalidNumbers = [
  NaN,
  Infinity,
  -Infinity,
  -1,
  -0.5,
  0.5,
  1.5,
  2 ** 32,
  2 ** 32 + 1,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
];

// These values previously wrapped/truncated at an i32 Wasm ABI boundary before
// Rust could reject them. Test both fresh and nonempty model states.
withModel(new SiliconSimulation("{}"), (model) => {
  model.advance(7);
  for (const value of [...invalidNumbers, 257]) {
    rejectsAtomically(
      model,
      () => model.advance(value),
      `silicon advance(${String(value)})`,
    );
  }
  const before = snapshot(model);
  assert.deepEqual(JSON.parse(model.advance(0)), before);
  assert.deepEqual(JSON.parse(model.advance(-0)), before);
  assertions += 2;
});
withModel(new FabricSimulation("voq"), (model) => {
  model.inject(1, 6);
  model.advance(1);
  for (const value of invalidNumbers) {
    rejectsAtomically(
      model,
      () => model.advance(value),
      `fabric advance(${value})`,
    );
    rejectsAtomically(
      model,
      () => model.inject(value, 1),
      `inject egress ${value}`,
    );
    rejectsAtomically(
      model,
      () => model.inject(0, value),
      `inject count ${value}`,
    );
    rejectsAtomically(
      model,
      () => model.block(value, true),
      `block egress ${value}`,
    );
  }
  for (const value of [3, 64, 256, 4096]) {
    rejectsAtomically(
      model,
      () => model.inject(value, 1),
      `egress upper bound ${value}`,
    );
    rejectsAtomically(
      model,
      () => model.block(value, true),
      `block upper bound ${value}`,
    );
  }
  for (const count of [0, 65]) {
    rejectsAtomically(
      model,
      () => model.inject(2, count),
      `burst bound ${count}`,
    );
  }
  rejectsAtomically(
    model,
    () => model.advance(4097),
    "fabric batch upper bound",
  );
  rejectsAtomically(
    model,
    () => model.queue_mode("unknown"),
    "unknown queue mode",
  );
  assert.deepEqual(JSON.parse(model.advance(0)), snapshot(model));
  assertions++;
});

// Constructors validate the full JSON schema, not just the outer string size.
for (const config of [
  "not JSON",
  "null",
  "[]",
  " ".repeat(8193),
  JSON.stringify({ mode: "npu" }),
  JSON.stringify({ layout: "random" }),
  JSON.stringify({ filter: "unknown" }),
  JSON.stringify({ extra: true }),
  ...[0, 3, 1.5, -1, 2 ** 32].map((issue_width) =>
    JSON.stringify({ issue_width }),
  ),
  ...[63, 65].map((length) => JSON.stringify({ input: Array(length).fill(0) })),
  ...[9, -9, 1.5, null, "1"].map((value) =>
    JSON.stringify({ input: Array(64).fill(value) }),
  ),
]) {
  assert.throws(
    () => new SiliconSimulation(config),
    undefined,
    `Invalid constructor ${config.slice(0, 100)}`,
  );
  assertions++;
}
for (const mode of ["", "VOQ", "unknown"]) {
  assert.throws(() => new FabricSimulation(mode));
  assertions++;
}

const input = Array.from({ length: 64 }, (_, i) => ((i * 11 + 3) % 17) - 8);
// Independent semantic oracle: difference filter, not a copy of engine weights.
const expected = input.map((value, i) => value - (i % 8 ? input[i - 1] : 0));
function complete(config) {
  return withModel(new SiliconSimulation(JSON.stringify(config)), (model) => {
    const initial = snapshot(model);
    let final = initial;
    for (let batch = 0; batch < 80 && final.status !== "complete"; batch++) {
      final = JSON.parse(model.advance(256));
    }
    assert.equal(final.status, "complete", "bounded workloads terminate");
    assert.deepEqual(final.output, expected);
    assert.deepEqual(final.valid, Array(64).fill(true));
    assert.equal(final.counters.macs, 512);
    assert.equal(final.counters.completed_outputs, 64);
    assert.ok(final.transfers.length <= 64);
    assert.ok(final.transfers.every((event) => event.end_tick <= final.tick));
    assert.deepEqual(
      JSON.parse(model.advance(256)),
      final,
      "completed model freezes",
    );
    assert.equal(final.detail.outputs.length, 64);
    assert.equal(
      final.detail.outputs.reduce(
        (sum, output) => sum + output.terms.length,
        0,
      ),
      512,
      "bounded provenance has one record per actual retired multiplication",
    );
    assert.deepEqual(
      final.detail.outputs.map((output) => output.accumulated_sum),
      expected,
    );
    assert.deepEqual(
      final.detail.outputs.map((output) => output.reference_sum),
      expected,
      "independent expected answers remain explicitly separate",
    );
    assert.ok(
      final.detail.outputs.every(
        (output) =>
          output.stored &&
          output.retired_terms === 8 &&
          output.terms.every(
            (term, k) =>
              term.k === k &&
              term.product === term.a * term.b &&
              term.retired_tick < final.tick &&
              term.sum_after ===
                output.terms
                  .slice(0, k + 1)
                  .reduce((sum, item) => sum + item.product, 0),
          ),
      ),
    );
    assert.ok(
      initial.detail.outputs.every(
        (output) =>
          output.terms.length === 0 &&
          output.accumulated_sum === 0 &&
          !output.stored,
      ),
    );
    assert.deepEqual(
      JSON.parse(model.reset()),
      initial,
      "reset restores initial state",
    );
    assertions += 15;
    return final;
  });
}
const results = new Map();
for (const mode of ["cpu", "gpu", "tensor"]) {
  for (const layout of ["packed", "strided"]) {
    results.set(
      `${mode}/${layout}`,
      complete({ mode, layout, input, filter: "difference" }),
    );
  }
}
const cached = results.get("cpu/packed");
const uncached = complete({ mode: "cpu", input, cache_enabled: false });
assert.ok(cached.counters.cache_hits > 0);
assert.ok(cached.counters.merged_misses > 0);
assert.equal(uncached.counters.cache_hits, 0);
assert.ok(cached.tick < uncached.tick);
assert.ok(
  results.get("gpu/packed").counters.sectors <
    results.get("gpu/strided").counters.sectors,
);
assert.equal(results.get("gpu/packed").counters.loads, 1024);
assert.equal(results.get("tensor/packed").counters.loads, 256);
assertions += 7;

// Browser-visible execution detail must not turn known input values into
// already-loaded registers or completed arithmetic before the model arrives.
for (const layout of ["packed", "strided"]) {
  withModel(
    new SiliconSimulation(JSON.stringify({ mode: "gpu", layout, input })),
    (model) => {
      const initial = snapshot(model);
      assert.equal(initial.detail.warps.length, 2);
      assert.ok(
        initial.detail.warps.every(
          (warp) =>
            warp.requested_a_sectors.length === 0 &&
            warp.requested_b_sectors.length === 0,
        ),
      );
      const sent = JSON.parse(model.advance(1));
      const warp = sent.detail.warps[0];
      assert.equal(warp.stage, "waiting_operands");
      assert.equal(warp.lanes.length, 32);
      assert.deepEqual(warp.requested_a_sectors, [0, 1, 2, 3]);
      assert.deepEqual(
        warp.requested_b_sectors,
        layout === "packed"
          ? [128]
          : Array.from({ length: 8 }, (_, i) => 128 + i),
      );
      assert.equal(
        sent.transfers[0].bytes,
        32 *
          (warp.requested_a_sectors.length + warp.requested_b_sectors.length),
      );
      assert.ok(warp.lanes.every((lane) => lane.a === null && lane.b === null));
      assert.deepEqual(
        warp.lanes.map((lane) => lane.b_address),
        Array.from(
          { length: 32 },
          (_, lane) => 4096 + (lane % 8) * (layout === "packed" ? 4 : 32),
        ),
      );
      model.advance(warp.ready_tick - sent.tick - 1);
      assert.ok(
        snapshot(model).detail.warps[0].lanes.every(
          (lane) => lane.a === null && lane.b === null,
        ),
      );
      const arrived = JSON.parse(model.advance(1));
      assert.ok(
        arrived.detail.warps[0].lanes.every(
          (lane) =>
            lane.a === input[Math.floor(lane.output_index / 8) * 8] &&
            lane.b === arrived.weights[lane.output_index % 8] &&
            lane.retired_terms === 0 &&
            lane.accumulated_sum === 0,
        ),
      );
      assert.equal(arrived.counters.macs, 0);
      assertions += 12;
    },
  );
}
withModel(
  new SiliconSimulation(JSON.stringify({ mode: "cpu", input })),
  (model) => {
    const sent = JSON.parse(model.advance(1));
    assert.equal(sent.detail.cpu_jobs.length, 64);
    assert.deepEqual(
      [sent.detail.cpu_jobs[0].a, sent.detail.cpu_jobs[0].b],
      [null, null],
    );
    assert.equal(sent.detail.cache.lru_to_mru.length, 0);
    assert.deepEqual(sent.detail.cache.pending_fills, [
      { tag: 0, arrival_tick: 8 },
    ]);
    model.advance(6);
    assert.equal(snapshot(model).detail.cpu_jobs[0].a, null);
    const arrived = JSON.parse(model.advance(1));
    assert.equal(arrived.detail.cpu_jobs[0].a, input[0]);
    assert.equal(arrived.detail.cpu_jobs[0].b, null);
    assert.deepEqual(arrived.detail.cache.lru_to_mru, [
      { tag: 0, base_address: 0 },
    ]);
    assert.equal(arrived.detail.outputs[0].terms.length, 0);
    assertions += 9;
  },
);
assert.equal(uncached.detail.cache.enabled, false);
assert.deepEqual(uncached.detail.cache.lru_to_mru, []);
assert.deepEqual(uncached.detail.cache.pending_fills, []);
assertions += 3;

// Non-default supported issue width, maximum tick batch, and chunking semantics.
withModel(
  new SiliconSimulation(JSON.stringify({ issue_width: 1 })),
  (batch) => {
    withModel(
      new SiliconSimulation(JSON.stringify({ issue_width: 1 })),
      (single) => {
        batch.advance(256);
        for (let tick = 0; tick < 256; tick++) single.advance(1);
        assert.deepEqual(snapshot(batch), snapshot(single));
        assertions++;
      },
    );
  },
);

// Valid endpoints/count boundaries, capacity overflow, held transfers and release.
withModel(new FabricSimulation("fifo"), (model) => {
  const initial = snapshot(model);
  model.block(0, true);
  const full = JSON.parse(model.inject(0, 64));
  assert.equal(full.attempted, 64);
  assert.equal(full.admitted, 32);
  assert.equal(full.dropped, 32);
  assert.equal(full.occupied, 32);
  assert.equal(full.conserved, true);
  assert.equal(JSON.parse(model.advance(4096)).delivered, 0);
  const beforeMode = snapshot(model);
  const afterMode = JSON.parse(model.queue_mode("voq"));
  assert.deepEqual(
    afterMode.packets.map((p) => p.id),
    beforeMode.packets.map((p) => p.id),
  );
  model.block(0, false);
  const delivered = JSON.parse(model.advance(40));
  assert.equal(delivered.delivered, 32);
  assert.equal(delivered.occupied, 0);
  assert.equal(delivered.conserved, true);
  const reset = JSON.parse(model.reset());
  assert.equal(reset.tick, initial.tick);
  assert.equal(reset.attempted, 0);
  assert.equal(
    reset.config.queue_mode,
    "voq",
    "reset retains chosen queue mode",
  );
  for (const egress of [0, 1, 2]) model.inject(egress, 1);
  const endpoints = JSON.parse(model.advance(8));
  assert.deepEqual(endpoints.delivered_by_egress, [1, 1, 1]);
  assert.equal(endpoints.conserved, true);
  assertions += 15;
});

console.log(
  `Silicon Wasm: ${assertions} assertions passed against generated public/pkg/doke_bg.wasm.`,
);
