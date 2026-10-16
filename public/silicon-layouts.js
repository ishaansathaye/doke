/** Original functional layouts. No position or area is a vendor floorplan. */
export function makeLayout(
  family,
  level = "processor",
  profile = "rtx-5090",
  selectedUnit = 0,
  queueMode = "voq",
) {
  if (
    !["cpu", "gpu", "tensor", "switch"].includes(family) ||
    !["processor", "core", "execution"].includes(level)
  )
    throw new RangeError("Unknown exploration level");
  if (family === "switch" && !["fifo", "voq"].includes(queueMode))
    throw new RangeError("Unknown switch queue mode");
  const blocks = [],
    links = [],
    parts = [];
  const byKey = new Map();
  function block(key, title, architecture, x, z, w, d, options = {}) {
    const b = {
      key,
      title,
      architecture,
      region: blocks.length,
      position: [x, options.y ?? 0.1, z],
      size: [w, options.height ?? 0.16, d],
      style: options.style || "compute",
      label: options.label ?? false,
      nodes: options.nodes || [],
      ...options,
    };
    blocks.push(b);
    byKey.set(key, b);
    return b;
  }
  function link(a, b) {
    const A = byKey.get(a),
      B = byKey.get(b);
    if (A && B)
      links.push({
        from: [A.position[0], 0.015, A.position[2]],
        to: [B.position[0], 0.015, B.position[2]],
      });
  }
  function cell(parent, x, z, w = 0.045, d = 0.045, y = 0.205) {
    parts.push({
      type: "cuboid",
      parent: parent.region,
      position: [x, y, z],
      size: [w, 0.018, d],
    });
  }
  function banks(b, cols, rows) {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        cell(
          b,
          b.position[0] + ((c - (cols - 1) / 2) * b.size[0]) / (cols + 1),
          b.position[2] + ((r - (rows - 1) / 2) * b.size[2]) / (rows + 1),
          (b.size[0] / (cols + 1)) * 0.5,
          (b.size[2] / (rows + 1)) * 0.42,
          b.position[1] + b.size[1] / 2 + 0.025,
        );
  }
  let board = { position: [0, -0.18, 0], size: [6.4, 0.14, 4.65] },
    camera = [12.6, -0.22, 0.83, 0, 0, 0],
    detailNote =
      "Original functional schematic; positions and areas are not a physical floorplan.";
  if (family === "tensor") {
    if (level === "processor") {
      const matrix = block(
        "matrix",
        "256 × 256 MAC array",
        "matrix",
        0.35,
        -0.05,
        3.2,
        2.55,
        {
          label: true,
          enter: "core",
          representative: true,
          documentedMacs: 65_536,
          nodes: ["compute", "scheduler", "registers"],
        },
      );
      // Sampled surface texture: one decorative cell is not one physical MAC.
      banks(matrix, 16, 16);
      const buffer = block(
        "buffer",
        "Unified buffer",
        "buffer",
        -2.2,
        -0.15,
        0.7,
        2.8,
        {
          style: "memory",
          label: true,
          nodes: ["scratch"],
        },
      );
      banks(buffer, 2, 12);
      const weights = block(
        "weights",
        "Weight memory",
        "weights",
        2.55,
        -0.15,
        0.62,
        2.8,
        {
          style: "memory",
          label: true,
        },
      );
      banks(weights, 2, 12);
      block(
        "instruction",
        "Instruction control",
        "instruction",
        0,
        -1.8,
        5.3,
        0.38,
        {
          style: "control",
          label: true,
        },
      );
      const accumulator = block(
        "accumulator",
        "Accumulators",
        "accumulator",
        0.35,
        1.55,
        3.2,
        0.5,
        {
          style: "memory",
          label: true,
          nodes: ["output"],
        },
      );
      banks(accumulator, 16, 2);
      block(
        "interface",
        "Host interface",
        "interface",
        -2.1,
        1.65,
        1.35,
        0.42,
        {
          style: "io",
          nodes: ["memory"],
        },
      );
      for (const pair of [
        ["interface", "buffer"],
        ["weights", "matrix"],
        ["buffer", "matrix"],
        ["instruction", "matrix"],
        ["matrix", "accumulator"],
      ])
        link(...pair);
      detailNote =
        "TPU v1 reference: 65,536 MACs. Visible cells sample the array; positions and counts of drawn decorations are illustrative.";
    } else if (level === "core") {
      board.size = [6.4, 0.14, 5.0];
      for (let i = 0; i < 64; i++) {
        const window = block(
          "array-window-" + i,
          "Array window " + (i + 1),
          "matrix",
          -1.13 + (i % 8) * 0.4,
          -1.4 + Math.floor(i / 8) * 0.4,
          0.31,
          0.31,
          {
            enter: "execution",
            representative: true,
            nodes: i === 0 ? ["compute", "registers"] : [],
          },
        );
        banks(window, 2, 2);
      }
      const buffer = block(
        "buffer",
        "Activation buffer",
        "buffer",
        -2.25,
        0,
        0.7,
        3.2,
        {
          style: "memory",
          label: true,
          nodes: ["scratch"],
        },
      );
      banks(buffer, 2, 16);
      const weights = block(
        "weights",
        "Weight staging",
        "weights",
        2.55,
        0,
        0.65,
        3.2,
        {
          style: "memory",
          label: true,
        },
      );
      banks(weights, 2, 16);
      block(
        "instruction",
        "Instruction decode",
        "instruction",
        0,
        -2.03,
        5.6,
        0.34,
        {
          style: "control",
          label: true,
          nodes: ["scheduler"],
        },
      );
      block(
        "accumulator",
        "Accumulated results",
        "accumulator",
        0.2,
        1.98,
        3.8,
        0.38,
        {
          style: "memory",
          label: true,
          nodes: ["output"],
        },
      );
      block("interface", "Host", "interface", -2.45, 1.98, 0.8, 0.38, {
        style: "io",
        nodes: ["memory"],
      });
      for (const pair of [
        ["interface", "buffer"],
        ["buffer", "array-window-0"],
        ["weights", "array-window-7"],
        ["instruction", "array-window-0"],
        ["array-window-56", "accumulator"],
      ])
        link(...pair);
      camera = [13.2, -0.18, 0.9, 0, 0, 0];
      detailNote =
        "Sampled windows into the documented matrix array; 64 drawn windows are not 64 documented hardware partitions. Open one for a separate 4 × 4 teaching array.";
    } else {
      board.size = [6.4, 0.14, 4.9];
      block("memory", "Operand memory", "memory", -2.8, 0, 0.42, 3.2, {
        style: "memory",
        label: true,
        nodes: ["memory"],
      });
      const scratch = block(
        "scratch",
        "Loaded A & B",
        "buffer",
        -1.85,
        0,
        0.75,
        3.2,
        {
          style: "memory",
          label: true,
          nodes: ["scratch"],
        },
      );
      banks(scratch, 2, 16);
      block("scheduler", "Tile issue", "scheduler", 0.3, -1.85, 2.85, 0.32, {
        style: "control",
        label: true,
        nodes: ["scheduler"],
      });
      for (let i = 0; i < 16; i++)
        block(
          "pe" + i,
          "PE " + (i + 1),
          "pe",
          -0.85 + (i % 4) * 0.62,
          -1.04 + Math.floor(i / 4) * 0.68,
          0.48,
          0.48,
          {
            pe: i,
            lane: i,
            nodes: ["pe" + i],
          },
        );
      block("registers", "Wave operands", "registers", 2.15, -0.9, 1.0, 0.65, {
        style: "memory",
        nodes: ["registers"],
      });
      block("compute", "Wave step", "compute", 2.15, 0.3, 1.0, 0.65, {
        label: true,
        nodes: ["compute"],
      });
      block("output", "Stored results", "output", 0.3, 1.85, 3.8, 0.35, {
        style: "memory",
        label: true,
        nodes: ["output"],
      });
      link("memory", "scratch");
      link("scheduler", "compute");
      for (let i = 0; i < 16; i++) {
        if (i % 4 < 3) link("pe" + i, "pe" + (i + 1));
        if (i < 12) link("pe" + i, "pe" + (i + 4));
        if (i % 4 === 0 || i < 4) link("scratch", "pe" + i);
        if (i >= 12) link("pe" + i, "output");
      }
      detailNote =
        "Actual 4 × 4 output-stationary teaching array. This executes real integer products, not TPU v1 instruction timing or its weight-stationary dataflow.";
    }
  } else if (family === "switch") {
    if (level === "processor") {
      block("ingress", "Packet inputs", "ingress", -2.6, 0, 0.55, 3.25, {
        style: "io",
        label: true,
        nodes: ["ingress-0", "ingress-1", "ingress-2"],
      });
      const packet = block(
        "pipeline",
        "Packet processing",
        "parser",
        -1.25,
        -0.75,
        1.7,
        1.3,
        {
          enter: "core",
          label: true,
        },
      );
      banks(packet, 4, 3);
      const queues = block(
        "queues",
        "Buffer & queues",
        "queues",
        -1.25,
        0.9,
        1.7,
        1.35,
        {
          style: "memory",
          label: true,
          enter: "core",
          nodes: [
            "fifo-0",
            "fifo-1",
            "fifo-2",
            ...Array.from(
              { length: 9 },
              (_, i) => `voq-${Math.floor(i / 3)}-${i % 3}`,
            ),
          ],
        },
      );
      banks(queues, 6, 5);
      const fabric = block(
        "fabric",
        "Switch fabric",
        "fabric",
        1.0,
        0,
        1.85,
        2.8,
        {
          label: true,
          enter: "core",
          nodes: ["fabric", "scheduler"],
        },
      );
      banks(fabric, 7, 7);
      block("egress", "Packet outputs", "egress", 2.6, 0, 0.55, 3.25, {
        style: "io",
        label: true,
        nodes: ["egress-0", "egress-1", "egress-2"],
      });
      block("interface", "Ethernet & SerDes", "interface", 0, -1.92, 4.1, 0.3, {
        style: "control",
      });
      block("drop", "Admission limit", "drop", 0, 1.93, 1.75, 0.3, {
        style: "control",
        nodes: ["drop"],
      });
      for (const pair of [
        ["ingress", "pipeline"],
        ["pipeline", "queues"],
        ["queues", "fabric"],
        ["fabric", "egress"],
      ])
        link(...pair);
      detailNote =
        "Public packet-switch functions, not the G200 physical floorplan. Decorative banks do not assert queue, port or pipeline counts.";
    } else if (level === "core") {
      block("ingress", "Receive", "ingress", -2.5, -1.2, 0.7, 1.2, {
        style: "io",
        label: true,
        nodes: ["ingress-0", "ingress-1", "ingress-2"],
      });
      block("parser", "Parse headers", "parser", -1.3, -1.2, 1.1, 1.2, {
        style: "control",
        label: true,
      });
      const lookup = block(
        "lookup",
        "Forwarding lookup",
        "lookup",
        0.25,
        -1.2,
        1.5,
        1.2,
        { style: "memory", label: true },
      );
      banks(lookup, 6, 5);
      block("scheduler", "Scheduling", "scheduler", 2.0, -1.2, 1.35, 1.2, {
        style: "control",
        label: true,
        nodes: ["scheduler"],
      });
      const queues = block(
        "queues",
        "Destination queues",
        "queues",
        -1.6,
        0.7,
        2.3,
        1.7,
        {
          style: "memory",
          label: true,
          enter: "execution",
          nodes: [
            "fifo-0",
            "fifo-1",
            "fifo-2",
            ...Array.from(
              { length: 9 },
              (_, i) => `voq-${Math.floor(i / 3)}-${i % 3}`,
            ),
          ],
        },
      );
      banks(queues, 8, 6);
      const fabric = block(
        "fabric",
        "Transfer fabric",
        "fabric",
        0.7,
        0.7,
        1.55,
        1.7,
        { label: true, enter: "execution", nodes: ["fabric"] },
      );
      banks(fabric, 5, 5);
      block("egress", "Transmit", "egress", 2.3, 0.7, 0.75, 1.7, {
        style: "io",
        label: true,
        nodes: ["egress-0", "egress-1", "egress-2"],
      });
      block("drop", "Admission limit", "drop", -1.6, 1.93, 2.3, 0.3, {
        style: "control",
        nodes: ["drop"],
      });
      for (const pair of [
        ["ingress", "parser"],
        ["parser", "lookup"],
        ["lookup", "queues"],
        ["queues", "fabric"],
        ["scheduler", "fabric"],
        ["fabric", "egress"],
      ])
        link(...pair);
      detailNote =
        "Functional packet path. Parser and lookup are context; only queue admission, arbitration and delivery execute in the teaching model.";
    } else {
      board.size = [6.5, 0.14, 4.8];
      for (let ingress = 0; ingress < 3; ingress++) {
        const z = -1.2 + ingress * 1.2;
        block(
          `ingress-${ingress}`,
          `Input ${String.fromCharCode(65 + ingress)}`,
          "ingress",
          -2.72,
          z,
          0.5,
          0.78,
          { style: "io", label: true, nodes: [`ingress-${ingress}`] },
        );
        if (queueMode === "fifo") {
          const queue = block(
            `fifo-${ingress}`,
            `Input ${String.fromCharCode(65 + ingress)} FIFO`,
            "queues",
            -1.22,
            z,
            1.74,
            0.78,
            {
              style: "memory",
              label: true,
              ingress,
              queueMode,
              nodes: [`fifo-${ingress}`],
            },
          );
          banks(queue, 6, 2);
          link(`ingress-${ingress}`, queue.key);
        } else
          for (let destination = 0; destination < 3; destination++) {
            const queue = block(
              `voq-${ingress}-${destination}`,
              `Input ${String.fromCharCode(65 + ingress)} → ${String.fromCharCode(65 + destination)}`,
              "queues",
              -1.85 + destination * 0.63,
              z,
              0.48,
              0.78,
              {
                style: "memory",
                ingress,
                destination,
                queueMode,
                nodes: [`voq-${ingress}-${destination}`],
              },
            );
            banks(queue, 1, 5);
            link(`ingress-${ingress}`, queue.key);
          }
        block(
          `egress-${ingress}`,
          `Output ${String.fromCharCode(65 + ingress)}`,
          "egress",
          2.62,
          z,
          0.55,
          0.78,
          { style: "io", label: true, nodes: [`egress-${ingress}`] },
        );
      }
      block("fabric", "Transfer fabric", "fabric", 1.0, 0, 1.3, 3.2, {
        label: true,
        nodes: ["fabric"],
      });
      block(
        "scheduler",
        "Round-robin grants",
        "scheduler",
        0.5,
        -2.03,
        2.25,
        0.32,
        { style: "control", label: true, nodes: ["scheduler"] },
      );
      block("drop", "Capacity drops", "drop", -1.55, 2.03, 1.8, 0.32, {
        style: "control",
        label: true,
        nodes: ["drop"],
      });
      for (let ingress = 0; ingress < 3; ingress++) {
        if (queueMode === "fifo") link(`fifo-${ingress}`, "fabric");
        else
          for (let destination = 0; destination < 3; destination++)
            link(`voq-${ingress}-${destination}`, "fabric");
        link("fabric", `egress-${ingress}`);
      }
      link("scheduler", "fabric");
      detailNote = `Actual three-input, three-output teaching switch with 32 shared packet slots and ${queueMode === "fifo" ? "three arrival-ordered FIFOs" : "nine logical destination queues"}. This is not G200 port count, buffer size or proprietary scheduling.`;
    }
  } else if (level === "processor" && family === "gpu") {
    const count = profile === "h100-sxm" ? 132 : 170,
      cols = profile === "h100-sxm" ? 12 : 17,
      rows = Math.ceil(count / cols);
    const dx = 4.8 / cols,
      dz = 3.3 / rows;
    for (let i = 0; i < count; i++) {
      const b = block(
        "sm-" + i,
        "SM " + (i + 1),
        "sm",
        ((i % cols) - (cols - 1) / 2) * dx,
        (Math.floor(i / cols) - (rows - 1) / 2) * dz,
        dx * 0.78,
        dz * 0.78,
        {
          unit: i,
          enter: "core",
          nodes:
            i === selectedUnit ? ["compute", "scheduler", "registers"] : [],
        },
      );
      banks(b, 2, 2);
    }
    block(
      "l2",
      profile === "h100-sxm" ? "50 MB L2" : "96 MB L2",
      "l2",
      0,
      1.94,
      4.7,
      0.25,
      { style: "memory", label: true },
    );
    block("memory", "Device memory", "memory", -2.88, 0, 0.36, 3.45, {
      style: "memory",
      label: true,
      nodes: ["memory"],
    });
    block("dispatch", "Work distribution", "dispatch", 2.88, 0, 0.36, 3.45, {
      style: "control",
      label: true,
    });
    link("memory", "l2");
    link("l2", "sm-" + selectedUnit);
    link("dispatch", "sm-" + selectedUnit);
  } else if (level === "processor") {
    for (let group = 0; group < 2; group++) {
      const cx = group ? 1.5 : -1.5;
      for (let i = 0; i < 8; i++) {
        const n = group * 8 + i;
        const b = block(
          "core-" + n,
          "Core " + (n + 1),
          "core",
          cx + ((i % 4) - 1.5) * 0.58,
          -0.9 + Math.floor(i / 4) * 0.75,
          0.48,
          0.6,
          {
            unit: n,
            enter: "core",
            nodes:
              n === selectedUnit ? ["compute", "scheduler", "registers"] : [],
          },
        );
        banks(b, 3, 3);
      }
      block("l3-" + group, "Shared L3", "l3", cx, 0.56, 2.25, 0.42, {
        style: "memory",
        label: true,
      });
      for (let i = 0; i < 8; i++)
        link("core-" + (group * 8 + i), "l3-" + group);
    }
    block("io", "I/O & memory interface", "io", 0, 1.42, 2.8, 0.62, {
      style: "io",
      label: true,
      nodes: ["memory"],
    });
    link("l3-0", "io");
    link("l3-1", "io");
  } else if (level === "core" && family === "cpu") {
    block("branch", "Branch prediction", "branch", -2.15, -1.65, 1.3, 0.42, {
      style: "control",
      label: true,
    });
    block("fetch", "Instruction fetch", "fetch", -0.57, -1.65, 1.3, 0.42, {
      style: "control",
    });
    block("l1i", "L1 instruction cache", "l1i", 1.03, -1.65, 1.3, 0.42, {
      style: "memory",
      label: true,
    });
    block("decode", "Decode", "decode", -2.0, -0.91, 1.5, 0.5, {
      style: "control",
      label: true,
    });
    block(
      "uop-cache",
      "Decoded-op cache",
      "uop-cache",
      -0.35,
      -0.91,
      1.4,
      0.5,
      { style: "memory", label: true },
    );
    block("rename", "Rename & dispatch", "rename", -1.3, -0.17, 2.72, 0.43, {
      style: "control",
    });
    block("scheduler", "Ready work", "scheduler", -1.3, 0.49, 2.72, 0.43, {
      style: "control",
      label: true,
      nodes: ["scheduler"],
    });
    block(
      "registers",
      "Operand registers",
      "registers",
      -1.3,
      1.13,
      2.72,
      0.43,
      { style: "memory", label: true, nodes: ["registers"] },
    );
    for (let i = 0; i < 6; i++)
      block(
        "alu-" + i,
        "Integer ALU " + (i + 1),
        "integer",
        -2.45 + i * 0.46,
        1.77,
        0.36,
        0.38,
        { nodes: i === 0 ? ["compute"] : [], enter: "execution" },
      );
    for (let i = 0; i < 4; i++)
      block(
        "agu-" + i,
        "Address unit " + (i + 1),
        "loadstore",
        0.75 + (i % 2) * 0.6,
        0.15 + Math.floor(i / 2) * 0.63,
        0.48,
        0.43,
        { style: "io" },
      );
    block("l1d", "L1 data cache", "l1d", 1.05, 1.53, 1.1, 0.73, {
      style: "memory",
      label: true,
      nodes: ["cache"],
    });
    block("l2", "Private L2", "l2", 2.44, 0, 0.65, 3.78, {
      style: "memory",
      label: true,
    });
    block(
      "vector",
      "Vector / floating point",
      "vector",
      1.18,
      -0.86,
      1.1,
      0.61,
      { style: "compute", label: true },
    );
    block("retire", "Retire", "retire", 1.85, -0.15, 0.28, 0.36, {
      style: "control",
    });
    for (const pair of [
      ["branch", "fetch"],
      ["l1i", "fetch"],
      ["fetch", "decode"],
      ["decode", "rename"],
      ["uop-cache", "rename"],
      ["rename", "scheduler"],
      ["scheduler", "registers"],
      ["registers", "alu-0"],
      ["l2", "l1d"],
      ["l1d", "registers"],
    ])
      link(...pair);
    for (const b of blocks.filter((b) => b.style === "memory")) banks(b, 4, 3);
  } else if (level === "core") {
    board.size = [6.4, 0.14, 5.9];
    block(
      "instruction-cache",
      "Instruction cache",
      "instruction-cache",
      0,
      -2.44,
      5.4,
      0.28,
      { style: "memory", label: true },
    );
    for (let p = 0; p < 4; p++) {
      const x = p % 2 ? 1.42 : -1.42,
        z = p < 2 ? -1.07 : 1.07;
      block(
        "scheduler-" + p,
        "Warp scheduler " + (p + 1),
        "warp-scheduler",
        x,
        z - 0.7,
        2.45,
        0.24,
        {
          style: "control",
          label: p === 0,
          nodes: p === 0 ? ["scheduler"] : [],
        },
      );
      const rf = block(
        "registers-" + p,
        "Register file",
        "registers",
        x,
        z - 0.31,
        2.45,
        0.34,
        {
          style: "memory",
          label: p === 0,
          nodes: p === 0 ? ["registers"] : [],
        },
      );
      banks(rf, 16, 2);
      const lanes = block(
        "arithmetic-" + p,
        profile === "h100-sxm" ? "32 FP32 units" : "32 FP32 / INT32 units",
        "arithmetic",
        x - 0.37,
        z + 0.32,
        1.65,
        0.66,
        {
          enter: "execution",
          partition: p,
          label: p === 0,
          nodes: p === 0 ? ["compute"] : [],
        },
      );
      banks(lanes, 8, 4);
      const tensor = block(
        "tensor-" + p,
        "Tensor unit",
        "tensor",
        x + 0.92,
        z + 0.32,
        0.48,
        0.66,
        { style: "compute", label: p === 0 },
      );
      banks(tensor, 3, 4);
      block(
        "loadstore-" + p,
        "Load / store",
        "loadstore",
        x,
        z + 0.86,
        2.45,
        0.2,
        { style: "io", nodes: p === 0 ? ["memory"] : [] },
      );
      for (const key of ["registers-", "arithmetic-", "loadstore-"])
        link("scheduler-" + p, key + p);
    }
    block(
      "l1shared",
      profile === "h100-sxm" ? "L1 / shared · 256 KB" : "L1 / shared · 128 KB",
      "l1shared",
      0,
      2.18,
      5.4,
      0.23,
      { style: "memory", label: true },
    );
    if (profile !== "h100-sxm")
      block("ray", "Ray-tracing unit", "ray", -1.38, 2.66, 2.6, 0.26, {
        label: true,
      });
    block(
      "texture",
      "Texture processing",
      "texture",
      profile === "h100-sxm" ? 0 : 1.38,
      2.66,
      profile === "h100-sxm" ? 5.4 : 2.6,
      0.26,
      { style: "io", label: true },
    );
    camera = [14.2, -0.18, 0.9, 0, 0, 0];
  } else if (family === "gpu") {
    board.size = [6.2, 0.14, 4.6];
    block("memory", "Memory sectors", "memory", -2.5, 0, 0.64, 3.22, {
      style: "memory",
      label: true,
      nodes: ["memory"],
    });
    block(
      "scheduler",
      "Warp issue",
      "warp-scheduler",
      -0.45,
      -1.72,
      2.5,
      0.36,
      { style: "control", label: true, nodes: ["scheduler"] },
    );
    block(
      "registers",
      "Operand registers",
      "registers",
      1.65,
      -1.72,
      1.28,
      0.36,
      { style: "memory", label: true, nodes: ["registers"] },
    );
    for (let i = 0; i < 32; i++)
      block(
        "lane" + i,
        "Lane " + i,
        "lanes",
        -1.25 + (i % 8) * 0.48,
        -0.98 + Math.floor(i / 8) * 0.52,
        0.36,
        0.38,
        { lane: i, nodes: ["lane" + i], enter: null },
      );
    block(
      "compute",
      "Integer multiply + add",
      "lanes",
      -0.05,
      1.37,
      3.82,
      0.34,
      { label: true, nodes: ["compute"] },
    );
    block("output", "Output values", "output", -0.05, 1.95, 3.82, 0.3, {
      style: "memory",
      label: true,
      nodes: ["output"],
    });
    link("memory", "registers");
    link("scheduler", "compute");
    link("registers", "lane0");
    link("lane31", "compute");
    link("compute", "output");
  } else {
    block("memory", "Main memory", "memory", -2.5, 0, 0.64, 3.35, {
      style: "memory",
      label: true,
      nodes: ["memory"],
    });
    block("cache", "Four cache lines", "l1d", -1.1, -1.1, 1.45, 1.05, {
      style: "memory",
      label: true,
      nodes: ["cache"],
    });
    block("scheduler", "Ready work", "scheduler", 1.05, -1.38, 2.1, 0.5, {
      style: "control",
      label: true,
      nodes: ["scheduler"],
    });
    block(
      "registers",
      "Returned operands",
      "registers",
      1.05,
      -0.48,
      2.1,
      0.66,
      { style: "memory", label: true, nodes: ["registers"] },
    );
    block("compute", "Multiply + add", "integer", 1.05, 0.57, 2.1, 0.72, {
      label: true,
      nodes: ["compute"],
    });
    block("output", "Completed result", "output", 0.2, 1.68, 3.8, 0.43, {
      style: "memory",
      label: true,
      nodes: ["output"],
    });
    for (const pair of [
      ["memory", "cache"],
      ["cache", "registers"],
      ["scheduler", "registers"],
      ["registers", "compute"],
      ["compute", "output"],
    ])
      link(...pair);
    for (const b of blocks.filter((b) => b.style === "memory")) banks(b, 5, 3);
  }
  return {
    family,
    level,
    blocks,
    links,
    parts,
    board,
    camera,
    detailNote,
    queueMode,
  };
}
export function resolveBlock(layout, nodeId) {
  return (
    layout.blocks.find((b) => b.key === nodeId) ||
    layout.blocks.find((b) => b.nodes.includes(nodeId))
  );
}
