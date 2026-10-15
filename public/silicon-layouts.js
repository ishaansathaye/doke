/** Original functional schematics. Positions are not vendor die coordinates. */
const HEIGHT = 0.1;
const THICKNESS = 0.12;

/** Build an independent layout; callers may attach transient display state. */
export function makeLayout(mode) {
  if (!["cpu", "gpu", "tensor", "switch"].includes(mode)) {
    throw new RangeError("Unknown silicon layout");
  }
  const blocks = [];
  const links = [];
  const byKey = new Map();
  function block(key, title, x, z, width, depth, description, label = false) {
    const item = {
      key,
      title,
      region: blocks.length,
      position: [x, HEIGHT, z],
      size: [width, THICKNESS, depth],
      description,
      label,
    };
    blocks.push(item);
    byKey.set(key, item);
    return item;
  }
  function link(from, to) {
    const a = byKey.get(from);
    const b = byKey.get(to);
    if (!a || !b) throw new Error("Unknown schematic link endpoint");
    // Static traces sit below the raised blocks. Moving data is supplied by the
    // model, not these links. Endpoints align with the actual block centers.
    links.push({
      from: [a.position[0], 0.015, a.position[2]],
      to: [b.position[0], 0.015, b.position[2]],
    });
  }

  if (mode === "cpu") {
    block(
      "memory",
      "Main memory",
      -1.34,
      -0.15,
      0.62,
      1.72,
      "Backing storage for the two input matrices. Each modeled load has an address; a cache miss moves bytes from here. Latencies are authored model ticks.",
      true,
    );
    block(
      "cache",
      "Cache",
      -0.31,
      -1.13,
      0.87,
      0.5,
      "Four fully associative 64-byte lines with true LRU replacement in this teaching model. Hits reuse a resident line; simultaneous requests for an outstanding line can merge.",
      true,
    );
    block(
      "scheduler",
      "Issue",
      0.89,
      -1.13,
      0.89,
      0.5,
      "Selects ready operations from independent dot products with a bounded issue width. This is not an x86 decoder, reorder buffer or speculative front end.",
      true,
    );
    block(
      "registers",
      "Operands",
      -0.31,
      0.03,
      0.87,
      0.72,
      "Loaded operand values wait here before multiply–accumulate. The displayed occupancy counts outstanding operand and compute requests, not architectural registers.",
    );
    block(
      "compute",
      "Multiply · add",
      0.89,
      0.03,
      0.89,
      0.72,
      "Computes exact signed integer products and accumulates each dot product. Operations issue only after both operands arrive.",
      true,
    );
    block(
      "scratch",
      "Tile storage · unused",
      -0.69,
      1.14,
      0.7,
      0.44,
      "Reserved explanatory location for tensor tile storage. It is inactive in CPU mode and does not add a cache or resource to this model.",
    );
    block(
      "output",
      "Result",
      0.8,
      1.14,
      1.08,
      0.44,
      "Completed matrix values arrive here after their modeled output transfer. A value becomes valid only at completion.",
      true,
    );
    for (const pair of [
      ["memory", "cache"],
      ["cache", "registers"],
      ["memory", "registers"],
      ["scheduler", "registers"],
      ["registers", "compute"],
      ["compute", "output"],
    ])
      link(...pair);
  }

  if (mode === "gpu" || mode === "tensor") {
    const tensor = mode === "tensor";
    block(
      "memory",
      "Memory",
      -1.43,
      -0.54,
      0.48,
      1.49,
      "Matrix operands are read from backing storage. Traffic is counted from the actual addresses and modeled transfer granularity, not inferred from glow intensity.",
      true,
    );
    block(
      "cache",
      "Cache · not modeled",
      -1.43,
      0.82,
      0.48,
      0.58,
      "This teaching mode does not simulate a GPU or tensor-accelerator cache hierarchy. The inactive block provides a consistent orientation across views.",
    );
    block(
      "scheduler",
      tensor ? "Tile sequence" : "Warp issue",
      -0.55,
      -1.32,
      0.66,
      0.32,
      tensor
        ? "Selects the next 4×4 output tile. The sequence and transfer costs are authored; this is not a commercial accelerator instruction scheduler."
        : "Issues one modeled warp operation at a time while two warps can retain work in flight. This illustrates scheduling, not every resource of a GPU SM.",
      true,
    );
    block(
      "registers",
      "Operands",
      0.33,
      -1.32,
      0.66,
      0.32,
      tensor
        ? "A shared orientation marker. Tensor operands are staged in the scratch tile; this block does not imply an extra register-file simulation."
        : "Warp operands become available after memory transfer. Duplicate addresses can share a request sector; lanes retain their own mathematical output identity.",
    );
    block(
      "compute",
      tensor ? "Array control" : "Compute",
      1.2,
      -1.32,
      0.65,
      0.32,
      tensor
        ? "Aggregate compute state for the processing-element array below. It is a schematic control marker, not additional arithmetic hardware."
        : "Aggregate state of the modeled warp arithmetic. The cells below show one identified warp in detail, not all cores of the selected commercial GPU.",
      true,
    );
    block(
      "scratch",
      "Tile storage",
      -0.4,
      1.28,
      0.92,
      0.36,
      tensor
        ? "Holds the A and B operands loaded for one output tile, allowing reuse across processing elements. Its modeled storage is distinct from external memory."
        : "Inactive in this GPU model. Shared-memory tiling would require an additional explicitly implemented mechanism.",
      tensor,
    );
    block(
      "output",
      "Result",
      0.99,
      1.28,
      0.95,
      0.36,
      "Exact output matrix values are published after their modeled store transfer. Partial arithmetic and completed outputs remain distinct.",
      true,
    );

    if (tensor) {
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const pe = row * 4 + col;
          block(
            `pe${pe}`,
            `Processing element ${row + 1} · ${col + 1}`,
            -0.63 + col * 0.55,
            -0.75 + row * 0.48,
            0.38,
            0.33,
            `Tile row ${row + 1}, column ${col + 1}. This processing element accumulates the products for one output value. Light follows the model's valid operand and multiply–accumulate events.`,
          );
          if (col > 0) link(`pe${pe - 1}`, `pe${pe}`);
          if (row > 0) link(`pe${pe - 4}`, `pe${pe}`);
        }
      }
      link("memory", "scratch");
      link("scheduler", "compute");
      for (let row = 0; row < 4; row++) link("scratch", `pe${row * 4}`);
      for (let col = 0; col < 4; col++) link("scratch", `pe${col}`);
      for (let col = 0; col < 4; col++) link(`pe${12 + col}`, "output");
    } else {
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 8; col++) {
          const lane = row * 8 + col;
          block(
            `lane${lane}`,
            `Warp lane ${lane}`,
            -0.8 + col * 0.31,
            -0.72 + row * 0.46,
            0.23,
            0.31,
            `Lane ${lane} of the displayed 32-lane warp. Its output index comes from the model snapshot. These 32 cells are a selected execution group, not a physical count of GPU cores.`,
          );
        }
      }
      link("memory", "registers");
      link("scheduler", "compute");
      link("registers", "compute");
      for (const lane of [0, 8, 16, 24]) link("registers", `lane${lane}`);
      for (const lane of [7, 15, 23, 31]) link(`lane${lane}`, "output");
    }
  }

  if (mode === "switch") {
    for (let ingress = 0; ingress < 3; ingress++) {
      const z = (ingress - 1) * 1.04;
      block(
        `ingress-${ingress}`,
        `Ingress ${ingress + 1}`,
        -1.57,
        z,
        0.35,
        0.59,
        `Input port ${ingress + 1}. Injected fixed-size packets enter the bounded shared storage here. Full capacity rejects a packet; no traffic is silently created or removed.`,
        ingress === 1,
      );
      for (let egress = 0; egress < 3; egress++) {
        block(
          `voq-${ingress}-${egress}`,
          `Queue ${ingress + 1} → ${egress + 1}`,
          -0.98 + egress * 0.37,
          z,
          0.26,
          0.43,
          `Packets arriving at input ${ingress + 1} for output ${egress + 1}. In VOQ mode, another destination can proceed when this one is blocked. FIFO mode consolidates the input's queue at its middle cell.`,
        );
        link(`ingress-${ingress}`, `voq-${ingress}-${egress}`);
      }
    }
    block(
      "fabric",
      "Grant · transfer",
      0.58,
      0,
      0.57,
      2.65,
      "A generic rotating arbiter grants at most one transfer per input and output in a tick. Each output has one transfer slot; a blocked output retains its occupied credit. This is not a proprietary Cisco scheduler.",
      true,
    );
    for (let egress = 0; egress < 3; egress++) {
      block(
        `egress-${egress}`,
        `Output ${"ABC"[egress]}`,
        1.48,
        (egress - 1) * 1.04,
        0.42,
        0.59,
        `Output port ${egress + 1}. Blocking it prevents completion and new grants to this destination. Releasing it allows held work to drain. Other destinations can still proceed in VOQ mode.`,
        true,
      );
      link("fabric", `egress-${egress}`);
      for (let ingress = 0; ingress < 3; ingress++)
        link(`voq-${ingress}-${egress}`, "fabric");
    }
  }
  return { blocks, links };
}

/** Map exact model IDs, plus explicit display aliases, to selectable geometry. */
export function resolveBlock(layout, nodeId) {
  if (!layout || !Array.isArray(layout.blocks) || typeof nodeId !== "string") {
    return undefined;
  }
  const exact = layout.blocks.find((block) => block.key === nodeId);
  if (exact) return exact;
  const fifo = /^fifo-([0-2])$/.exec(nodeId);
  if (fifo)
    return layout.blocks.find((block) => block.key === `voq-${fifo[1]}-1`);
  // There is no additional physical scheduler or drop engine in this schematic.
  // These aliases locate abstract events on the central switch mechanism.
  if (nodeId === "scheduler" || nodeId === "drop") {
    return layout.blocks.find((block) => block.key === "fabric");
  }
  return undefined;
}
