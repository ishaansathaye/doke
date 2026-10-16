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
  check(["cpu", "gpu"].includes(family), `Focused family ${family}`);
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
      (item) => item.id === profile.id && item.family === profile.family,
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
  check(
    (profile.family === "cpu" ? data.counts.cores : data.counts.sms) ===
      profile.units,
    `${profile.id}: enabled product unit count, not full die`,
  );

  // The first and last unit must both be selectable, including high region IDs.
  for (const selected of [0, profile.units - 1]) {
    for (const level of levels) {
      const label = `${profile.id}/${level}/${selected}`;
      const layout = makeLayout(profile.family, level, profile.id, selected);
      layouts.push(layout);
      check(
        layout.family === profile.family && layout.level === level,
        `${label}: requested view`,
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
        check(!keys.has(block.key), `${label}: unique block key ${block.key}`);
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
      if (level === "processor") {
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
        for (const node of [
          "memory",
          "scheduler",
          "registers",
          "compute",
          "output",
          ...(profile.family === "cpu"
            ? ["cache"]
            : Array.from({ length: 32 }, (_, i) => `lane${i}`)),
        ]) {
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
      }
      check(
        resolveBlock(layout, "nonexistent-node") === undefined,
        `${label}: unknown nodes do not invent a destination`,
      );
    }
  }
}
assert.throws(() => makeLayout("tensor"), RangeError);
assert.throws(() => makeLayout("cpu", "unknown"), RangeError);
checks += 2;
console.log(
  `Architecture: ${checks} checks passed across ${layouts.length} source-backed layouts.`,
);
