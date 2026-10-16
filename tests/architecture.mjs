/** Source-backed architecture, bounded geometry, and navigation contracts. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeLayout, resolveBlock } from "../public/silicon-layouts.js";

const architecture = JSON.parse(
  readFileSync(new URL("../public/architecture.json", import.meta.url)),
);
const hardware = JSON.parse(
  readFileSync(new URL("../public/hardware.json", import.meta.url)),
);
const levels = ["processor", "core", "execution"];
const profiles = [
  { id: "ryzen-9950x", family: "cpu", units: 16, unit: "core" },
  { id: "rtx-5090", family: "gpu", units: 170, unit: "sm" },
  { id: "h100-sxm", family: "gpu", units: 132, unit: "sm" },
  { id: "tpu-v1", family: "tensor", catalogFamily: "npu" },
  { id: "silicon-one-g200", family: "switch", catalogFamily: "asic" },
];
const modelNodes = new Set([
  "memory",
  "cache",
  "scheduler",
  "registers",
  "compute",
  "scratch",
  "output",
  ...Array.from({ length: 32 }, (_, i) => `lane${i}`),
  ...Array.from({ length: 16 }, (_, i) => `pe${i}`),
  "fabric",
  "drop",
  ...Array.from({ length: 3 }, (_, i) => `ingress-${i}`),
  ...Array.from({ length: 3 }, (_, i) => `egress-${i}`),
  ...Array.from({ length: 3 }, (_, i) => `fifo-${i}`),
  ...Array.from({ length: 9 }, (_, i) => `voq-${Math.floor(i / 3)}-${i % 3}`),
]);
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
function references(ids, label) {
  check(Array.isArray(ids) && ids.length > 0, `${label} has sources`);
  for (const id of ids)
    check(architecture.sources[id], `${label}: source ${id} resolves`);
}
function vector(value, label, positive = false) {
  check(
    Array.isArray(value) && value.length === 3,
    `${label}: three coordinates`,
  );
  check(
    value.every(
      (number) =>
        Number.isFinite(number) &&
        Math.abs(number) <= 8 &&
        (!positive || number >= 0.0001),
    ),
    `${label}: bounded finite ${positive ? "dimensions" : "coordinates"}`,
  );
}
const epsilon = 1e-6;
function containsXZ(outer, inner) {
  return [0, 2].every(
    (axis) =>
      Math.abs(inner.position[axis] - outer.position[axis]) +
        inner.size[axis] / 2 <=
      outer.size[axis] / 2 + epsilon,
  );
}

check(architecture.schema_version === 1, "Known architecture schema");
check(
  /^\d{4}-\d{2}-\d{2}$/.test(architecture.checked_on),
  "Research has a review date",
);
check(
  /schematic|floorplan/i.test(architecture.scope),
  "Architecture distinguishes physical layout from schematic",
);
for (const [id, source] of Object.entries(architecture.sources)) {
  check(
    source.title && source.locator,
    `${id}: source has title and claim locator`,
  );
  const url = new URL(source.url);
  check(url.protocol === "https:", `${id}: source uses HTTPS`);
  check(!url.username && !url.password, `${id}: no credentials in source URL`);
}
for (const [family, info] of Object.entries(architecture.families)) {
  check(
    ["cpu", "gpu", "tensor", "switch"].includes(family),
    `Focused family ${family}`,
  );
  assert.deepEqual(
    info.levels.map((level) =>
      level.id === "package" ? "processor" : level.id,
    ),
    levels,
  );
  checks++;
  for (const [key, block] of Object.entries(info.blocks)) {
    const label = `${family}/${key}`;
    check(
      block.title && block.summary && block.modelNote,
      `${label}: explanation and model boundary`,
    );
    check(
      Array.isArray(block.detail) &&
        block.detail.length >= 2 &&
        block.detail.every(
          (paragraph) => typeof paragraph === "string" && paragraph.length > 20,
        ),
      `${label}: substantive detail`,
    );
    check(
      Array.isArray(block.path) && block.path.length >= 2,
      `${label}: navigation path`,
    );
    check(
      ["package", "processor", "core", "execution"].includes(block.level),
      `${label}: known level`,
    );
    references(block.sources, label);
    check(
      typeof block.modeled === "boolean",
      `${label}: explicit executable/context status`,
    );
    check(
      Array.isArray(block.modelNodes) &&
        block.modelNodes.every((node) => modelNodes.has(node)),
      `${label}: model node references resolve`,
    );
    check(
      block.modeled || block.modelNodes.length === 0,
      `${label}: context is not labeled as executable state`,
    );
  }
}

const layouts = [];
for (const profile of profiles) {
  const data = architecture.profiles[profile.id];
  check(data?.family === profile.family, `${profile.id}: correct family`);
  check(
    hardware.profiles.some(
      (item) =>
        item.id === profile.id &&
        item.family === (profile.catalogFamily || profile.family),
    ),
    `${profile.id}: public catalog agrees`,
  );
  references(data.sources, profile.id);
  check(
    data.topology_note.length > 50,
    `${profile.id}: topology limits disclosed`,
  );
  for (const fact of data.facts) {
    check(fact.label && fact.value, `${profile.id}: labeled fact`);
    references(fact.sources, `${profile.id}/${fact.label}`);
  }
  check(
    data.hidden_blocks.every(
      (id) => architecture.families[profile.family].blocks[id],
    ),
    `${profile.id}: hidden block references resolve`,
  );
  if (profile.units !== undefined) {
    check(
      (profile.family === "cpu" ? data.counts.cores : data.counts.sms) ===
        profile.units,
      `${profile.id}: enabled product unit count, not full die`,
    );
  }
  if (profile.family === "tensor") {
    check(
      data.counts.array_rows === 256 &&
        data.counts.array_columns === 256 &&
        data.counts.macs === 65_536,
      `${profile.id}: historical TPUv1 array dimensions and MAC count agree`,
    );
    check(
      data.counts.model_rows === 4 && data.counts.model_columns === 4,
      `${profile.id}: separate teaching array is declared`,
    );
  }
  if (profile.family === "switch") {
    check(
      data.counts.model_ingresses === 3 && data.counts.model_egresses === 3,
      `${profile.id}: teaching port count is separate from product interfaces`,
    );
  }

  // The first and last unit must both be selectable, including high region IDs.
  for (const selected of profile.units === undefined
    ? [0]
    : [0, profile.units - 1]) {
    for (const level of levels) {
      for (const queueMode of profile.family === "switch" &&
      level === "execution"
        ? ["voq", "fifo"]
        : ["voq"]) {
        const label = `${profile.id}/${level}/${selected}/${queueMode}`;
        const layout = makeLayout(
          profile.family,
          level,
          profile.id,
          selected,
          queueMode,
        );
        layouts.push(layout);
        check(
          layout.family === profile.family && layout.level === level,
          `${label}: requested view`,
        );
        check(
          typeof layout.detailNote === "string" &&
            layout.detailNote.length > 30,
          `${label}: geometry/model scope stated`,
        );
        check(
          layout.blocks.length > 0 && layout.blocks.length <= 240,
          `${label}: bounded block count`,
        );
        check(
          layout.links.length <= 512 && layout.parts.length <= 2048,
          `${label}: bounded detail geometry`,
        );
        check(
          JSON.stringify(layout).length <= 512 * 1024,
          `${label}: bounded renderer payload`,
        );
        vector(layout.board.position, `${label}/board`);
        vector(layout.board.size, `${label}/board`, true);
        check(
          Array.isArray(layout.camera) &&
            layout.camera.length === 6 &&
            layout.camera.every(Number.isFinite),
          `${label}: finite camera`,
        );
        const keys = new Set();
        const regions = new Set();
        for (const block of layout.blocks) {
          check(
            !keys.has(block.key),
            `${label}: unique block key ${block.key}`,
          );
          keys.add(block.key);
          check(
            Number.isInteger(block.region) &&
              block.region >= 0 &&
              block.region < 240 &&
              !regions.has(block.region),
            `${label}: unique selectable region ${block.region}`,
          );
          regions.add(block.region);
          check(
            architecture.families[profile.family].blocks[block.architecture],
            `${label}/${block.key}: architectural explanation resolves`,
          );
          check(
            !data.hidden_blocks.includes(block.architecture),
            `${label}/${block.key}: respects product exclusions`,
          );
          vector(block.position, `${label}/${block.key}`);
          vector(block.size, `${label}/${block.key}`, true);
          check(
            containsXZ(layout.board, block),
            `${label}/${block.key}: inside substrate`,
          );
          check(
            block.nodes.every((node) => modelNodes.has(node)),
            `${label}/${block.key}: live node references resolve`,
          );
          check(
            !block.enter || levels.indexOf(block.enter) > levels.indexOf(level),
            `${label}/${block.key}: drill-down goes deeper`,
          );
          check(
            resolveBlock(layout, block.key) === block,
            `${label}/${block.key}: selection resolves exactly`,
          );
        }
        for (let a = 0; a < layout.blocks.length; a++) {
          for (let b = a + 1; b < layout.blocks.length; b++) {
            const first = layout.blocks[a],
              second = layout.blocks[b];
            const overlap = [0, 1, 2].every(
              (axis) =>
                Math.abs(first.position[axis] - second.position[axis]) <
                (first.size[axis] + second.size[axis]) / 2 - epsilon,
            );
            check(
              !overlap,
              `${label}: selectable blocks ${first.key} and ${second.key} overlap`,
            );
          }
        }
        for (const part of layout.parts) {
          const parent = layout.blocks.find(
            (block) => block.region === part.parent,
          );
          check(parent, `${label}: decorative detail has selectable parent`);
          if (part.type === "cuboid") {
            vector(part.position, `${label}/detail`);
            vector(part.size, `${label}/detail`, true);
            check(
              containsXZ(parent, part),
              `${label}: decorative banks remain inside their block`,
            );
          } else {
            check(
              part.type === "tube" && Array.isArray(part.points),
              `${label}: supported decorative primitive`,
            );
          }
        }
        for (const route of layout.links) {
          for (const endpoint of [route.from, route.to]) {
            vector(endpoint, `${label}/route`);
            check(
              layout.blocks.some(
                (block) =>
                  Math.abs(block.position[0] - endpoint[0]) < epsilon &&
                  Math.abs(block.position[2] - endpoint[2]) < epsilon,
              ),
              `${label}: route endpoint identifies a real block`,
            );
          }
        }
        if (level === "processor" && profile.units !== undefined) {
          const units = layout.blocks.filter(
            (block) => block.architecture === profile.unit,
          );
          check(
            units.length === profile.units,
            `${label}: renders every enabled product unit`,
          );
          assert.deepEqual(
            units.map((block) => block.unit),
            Array.from({ length: profile.units }, (_, i) => i),
          );
          checks++;
          check(
            units.every((block) => block.enter === "core"),
            `${label}: every core/SM opens its internals`,
          );
          check(
            resolveBlock(layout, "compute").unit === selected,
            `${label}: selected aggregate is the live unit`,
          );
        }
        if (profile.family === "gpu" && level === "core") {
          check(
            layout.blocks.filter(
              (block) => block.architecture === "warp-scheduler",
            ).length === 4,
            `${label}: four SM partitions`,
          );
          check(
            layout.blocks.filter((block) => block.architecture === "tensor")
              .length === 4,
            `${label}: four tensor units`,
          );
          const arithmetic = layout.blocks.filter(
            (block) => block.architecture === "arithmetic",
          );
          check(
            arithmetic.length === 4 &&
              arithmetic.every(
                (block) =>
                  layout.parts.filter((part) => part.parent === block.region)
                    .length === 32,
              ),
            `${label}: four groups of 32 arithmetic cells`,
          );
          check(
            !layout.blocks.some((block) => block.architecture === "lanes"),
            `${label}: physical arithmetic units are not logical warp lanes`,
          );
          check(
            layout.blocks
              .find((block) => block.architecture === "l1shared")
              .title.includes(profile.id === "h100-sxm" ? "256 KB" : "128 KB"),
            `${label}: profile-specific shared capacity`,
          );
        }
        if (profile.family === "cpu" && level === "core") {
          check(
            layout.blocks.filter((block) => block.key.startsWith("alu-"))
              .length === 6,
            `${label}: six Zen 5 ALUs`,
          );
          check(
            layout.blocks.filter((block) => block.key.startsWith("agu-"))
              .length === 4,
            `${label}: four Zen 5 address-generation units`,
          );
        }
        if (level === "execution") {
          const nodes =
            profile.family === "switch"
              ? [
                  "fabric",
                  "scheduler",
                  "drop",
                  ...Array.from({ length: 3 }, (_, i) => `ingress-${i}`),
                  ...Array.from({ length: 3 }, (_, i) => `egress-${i}`),
                  ...(queueMode === "fifo"
                    ? Array.from({ length: 3 }, (_, i) => `fifo-${i}`)
                    : Array.from(
                        { length: 9 },
                        (_, i) => `voq-${Math.floor(i / 3)}-${i % 3}`,
                      )),
                ]
              : [
                  "memory",
                  "scheduler",
                  "registers",
                  "compute",
                  "output",
                  ...(profile.family === "cpu"
                    ? ["cache"]
                    : profile.family === "gpu"
                      ? Array.from({ length: 32 }, (_, i) => `lane${i}`)
                      : [
                          "scratch",
                          ...Array.from({ length: 16 }, (_, i) => `pe${i}`),
                        ]),
                ];
          for (const node of nodes) {
            check(
              resolveBlock(layout, node),
              `${label}: every executed node has a visible block (${node})`,
            );
          }
          if (profile.family === "gpu")
            check(
              layout.blocks.filter((block) => Number.isInteger(block.lane))
                .length === 32,
              `${label}: logical warp has 32 lanes`,
            );
          if (profile.family === "tensor") {
            const elements = layout.blocks.filter((block) =>
              Number.isInteger(block.pe),
            );
            check(
              elements.length === 16,
              `${label}: exactly16 executing PEs in the declared4×4 teaching array`,
            );
            assert.deepEqual(
              elements.map((block) => block.pe),
              Array.from({ length: 16 }, (_, i) => i),
            );
            checks++;
            const neighbor = (from, to) =>
              layout.links.some(
                (link) =>
                  link.from[0] === from.position[0] &&
                  link.from[2] === from.position[2] &&
                  link.to[0] === to.position[0] &&
                  link.to[2] === to.position[2],
              );
            for (let i = 0; i < 16; i++) {
              if (i % 4 < 3)
                check(
                  neighbor(elements[i], elements[i + 1]),
                  `${label}: A moves to adjacent column`,
                );
              if (i < 12)
                check(
                  neighbor(elements[i], elements[i + 4]),
                  `${label}: B moves to adjacent row`,
                );
            }
            check(
              /output-stationary/.test(layout.detailNote),
              `${label}: teaching dataflow is stated`,
            );
          }
          if (profile.family === "switch") {
            check(
              layout.blocks.filter((block) => block.key.startsWith("ingress-"))
                .length === 3,
              `${label}: three teaching input ports`,
            );
            check(
              layout.blocks.filter((block) => block.key.startsWith("egress-"))
                .length === 3,
              `${label}: three teaching output ports`,
            );
            check(
              layout.blocks.filter((block) => block.architecture === "queues")
                .length === (queueMode === "fifo" ? 3 : 9),
              `${label}: actual queue count matches the selected discipline`,
            );
            for (let ingress = 0; ingress < 3; ingress++) {
              check(
                queueMode === "fifo"
                  ? resolveBlock(layout, `voq-${ingress}-1`) === undefined
                  : resolveBlock(layout, `fifo-${ingress}`) === undefined,
                `${label}: inactive discipline has no invented queue`,
              );
            }
            check(
              /not G200/.test(layout.detailNote),
              `${label}: teaching switch counts are not product specifications`,
            );
          }
        }
        if (profile.family === "tensor" && level !== "execution") {
          check(
            /sample/i.test(layout.detailNote),
            `${label}: sampled architecture is disclosed`,
          );
          if (level === "processor") {
            const matrix = layout.blocks.find(
              (block) => block.key === "matrix",
            );
            check(
              matrix.documentedMacs === 65_536 &&
                matrix.representative === true,
              `${label}: full documented TPUv1 MAC count remains separate from drawn cells`,
            );
            check(
              layout.parts.filter((part) => part.parent === matrix.region)
                .length < matrix.documentedMacs,
              `${label}: bounded representative array texture`,
            );
          } else {
            const windows = layout.blocks.filter((block) =>
              block.key.startsWith("array-window-"),
            );
            check(
              windows.length > 0 &&
                windows.every(
                  (block) =>
                    block.representative && block.enter === "execution",
                ),
              `${label}: representative windows enter the actual teaching array`,
            );
          }
        }
        check(
          resolveBlock(layout, "nonexistent-node") === undefined,
          `${label}: unknown nodes do not invent a destination`,
        );
      }
    }
  }
}
assert.throws(() => makeLayout("unknown"), RangeError);
assert.throws(() => makeLayout("cpu", "unknown"), RangeError);
assert.throws(
  () => makeLayout("switch", "execution", "silicon-one-g200", 0, "unknown"),
  RangeError,
);
checks += 3;
console.log(
  `Architecture: ${checks} checks passed across ${layouts.length} source-backed layouts.`,
);
