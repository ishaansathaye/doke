import { hdrCapable, configureHDR, HDRText } from "./display.js";
import { makeLayout, resolveBlock } from "./silicon-layouts.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let wasm, renderer, hdrText, catalog, model, snap, layout, profile;
let family = "gpu",
  playing = false,
  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let last = 0,
  accumulator = 0,
  tickPhase = 0.5,
  dirty = true,
  drag,
  selected = null,
  paint = false,
  brush = 0;
let input = pattern("diagonal"),
  panels = new Map(),
  currentPanel,
  nextModel = 0;
let canvas = $("#chip-canvas");
const panel = $("#inspector");
const pretty = (n) => Number(n).toLocaleString();
const byFamily = { cpu: "cpu", gpu: "gpu", tensor: "npu", switch: "asic" };
const names = {
  cpu: "GENERAL COMPUTE",
  gpu: "PARALLEL COMPUTE",
  tensor: "TENSOR COMPUTE",
  switch: "PACKET SWITCHING",
};
const tickRates = { cpu: 150, gpu: 18, tensor: 24, switch: 4 };
const comparing = new URLSearchParams(location.search).get("compare") === "1";
let comparisonContent;
const comparisonSources = new Map();
if (comparing) {
  document.body.classList.add("compare-mode");
  document.body.dataset.comparisonView = "silicon";
  for (const id of [
    "brain-stage",
    "comparison-heading",
    "comparison-views",
    "brain-guide",
  ])
    $("#" + id).hidden = false;
  $$(".worlds a").forEach((a) => a.removeAttribute("aria-current"));
  $("#compare-link").setAttribute("aria-current", "page");
}

function pattern(id) {
  return Array.from({ length: 64 }, (_, i) => {
    const r = i >> 3,
      c = i % 8;
    return id === "clear"
      ? 0
      : id === "stripes"
        ? c % 3 === 1
          ? 7
          : 0
        : id === "checker"
          ? (r + c) % 2
            ? 7
            : 0
          : Math.abs(r - c) < 2
            ? 7
            : 0;
  });
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2400);
}
function pause() {
  playing = false;
  accumulator = 0;
  updateControls();
  if (snap?.tick && snap.status !== "complete" && family !== "switch")
    $("#run-status").textContent = "Paused · inspect any block";
}
function updateControls() {
  $("#run").textContent = playing
    ? "Pause Ⅱ"
    : snap?.status === "complete"
      ? "Replay ↗"
      : "Run ↗";
  $("#run").setAttribute("aria-pressed", String(playing));
  for (const id of ["run", "step", "reset", "finish"])
    $("#" + id).disabled = !model;
  $("#finish").hidden = family === "switch";
  $("#step").disabled = !model || snap?.status === "complete";
}
function resetModel() {
  if (!wasm) return;
  pause();
  model?.free();
  if (family === "switch")
    model = new wasm.FabricSimulation($("#queue-mode").value);
  else
    model = new wasm.SiliconSimulation(
      JSON.stringify({
        mode: family,
        input,
        filter: "difference",
        layout: $("#memory-layout").value,
        cache_enabled: $("#cache-enabled").checked,
        issue_width: 2,
      }),
    );
  snap = JSON.parse(model.snapshot());
  nextModel++;
  tickPhase = 0.5;
  selected = null;
  renderer?.select(-1);
  updateSnapshot();
}
function snapshotFrom(result) {
  snap = JSON.parse(result);
  updateSnapshot();
  return snap;
}
function advance(n = 1) {
  if (!model) return;
  snapshotFrom(model.advance(n));
  if (snap.status === "complete") {
    pause();
    $("#run-status").textContent = "Complete · exact result ready";
  }
}
function finish() {
  pause();
  if (family === "switch") return snap;
  for (let i = 0; i < 400 && snap.status !== "complete"; i++)
    snap = JSON.parse(model.advance(256));
  if (snap.status !== "complete")
    throw Error("Model exceeded its bounded run budget");
  tickPhase = 1;
  updateSnapshot();
  return snap;
}
function updateSnapshot() {
  if (!snap) return;
  $("#tick-count").textContent = pretty(snap.tick);
  if (family === "switch") {
    $("#work-count").textContent = pretty(snap.delivered);
    $("#traffic-count").textContent = `${snap.occupied} / 32`;
    $("#work-label").textContent = "packets delivered";
    $("#traffic-label").textContent = "packet slots used";
    $("#run-status").textContent =
      `${snap.buffered} queued · ${snap.dropped} dropped`;
    for (let i = 0; i < 3; i++) {
      const b = $("#block-" + i);
      b.setAttribute("aria-pressed", String(snap.blocked[i]));
      b.textContent = `${snap.blocked[i] ? "Open" : "Block"} ${"ABC"[i]}`;
    }
  } else {
    $("#work-count").textContent = pretty(snap.counters.macs);
    $("#traffic-count").textContent = pretty(snap.counters.bytes_moved);
    $("#work-label").textContent = "useful MACs";
    $("#traffic-label").textContent = "modeled bytes moved";
    $("#output-status").textContent =
      `${snap.counters.completed_outputs} / 64 values ready`;
    $("#run-status").textContent =
      snap.status === "complete"
        ? "Complete · exact result ready"
        : playing
          ? "Following the computation"
          : snap.tick
            ? "Paused · inspect any block"
            : "Ready to follow your data";
    $("#scene-note").textContent =
      family === "gpu"
        ? `One 32-lane warp in view${snap.group_index == null ? "" : ` · warp ${snap.group_index + 1} of 2`}`
        : family === "tensor"
          ? `A 4 × 4 operand wave${snap.group_index == null ? "" : ` · tile ${snap.group_index + 1} of 4`}`
          : "A small scheduler. Real operand dependencies.";
  }
  updateControls();
  drawTiles();
  dirty = true;
  if (currentPanel?.startsWith("block:") && !panel.hidden)
    renderBlock(
      layout.blocks.find((b) => "block:" + b.key === currentPanel),
      false,
    );
  window.dispatchEvent(
    new CustomEvent("doke-silicon-state", {
      detail: { snapshot: snap, input: [...input], family },
    }),
  );
}
function drawTiles() {
  const draw = (c, values, valid, editable) => {
    const ctx = c.getContext("2d"),
      s = c.width / 8;
    ctx.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < 64; i++) {
      const v = values[i] || 0,
        open = !valid || valid[i];
      ctx.fillStyle = !open
        ? "#121819"
        : v < 0
          ? `rgb(${35 + Math.min(8, -v) * 12},${46 + Math.min(8, -v) * 7},${54 + Math.min(8, -v) * 4})`
          : `rgb(${27 + v * 26},${34 + v * 26},${35 + v * 25})`;
      ctx.fillRect((i % 8) * s + 1, (i >> 3) * s + 1, s - 2, s - 2);
      if (editable && document.activeElement === c && i === brush) {
        ctx.strokeStyle = "#ecfff8";
        ctx.lineWidth = 2;
        ctx.strokeRect((i % 8) * s + 2, (i >> 3) * s + 2, s - 4, s - 4);
      }
    }
  };
  draw($("#input-tile"), input, null, true);
  draw(
    $("#output-tile"),
    snap?.output || [],
    snap?.valid || Array(64).fill(false),
    false,
  );
}
function editAt(e) {
  const r = $("#input-tile").getBoundingClientRect(),
    x = Math.floor(((e.clientX - r.left) / r.width) * 8),
    y = Math.floor(((e.clientY - r.top) / r.height) * 8);
  if (x < 0 || x > 7 || y < 0 || y > 7) return;
  brush = y * 8 + x;
  input[brush] = paint.value;
  resetModel();
}
function setProfile(id, reset = true) {
  profile =
    catalog.profiles.find((p) => p.id === id) ||
    catalog.profiles.find((p) => p.family === byFamily[family]);
  $("#chip-profile").value = profile.id;
  $("#family-label").textContent = names[family];
  $("#model-caption").textContent =
    family === "switch"
      ? "Generic queue model · reference product facts"
      : family === "gpu"
        ? "One teaching warp · reference product facts"
        : family === "tensor"
          ? "Small teaching array · reference product facts"
          : "Small teaching scheduler · reference product facts";
  if (reset) resetModel();
  if (currentPanel === "reference" && !panel.hidden) showReference();
  dirty = true;
}
function changeFamily(value) {
  family = value;
  pause();
  panels.clear();
  closePanel();
  $$(".families button").forEach((b) => {
    b.classList.toggle("active", b.dataset.family === family);
    b.setAttribute("aria-pressed", String(b.dataset.family === family));
  });
  $("#packet-card").hidden = family !== "switch";
  $("#input-card").hidden = family === "switch";
  $("#output-card").hidden = family === "switch";
  $("#layout-control").hidden = !["cpu", "gpu"].includes(family);
  $("#cache-control").hidden = family !== "cpu";
  $("#queue-control").hidden = family !== "switch";
  $("#chip-profile").replaceChildren(
    ...catalog.profiles
      .filter((p) => p.family === byFamily[family])
      .map(
        (p) =>
          new Option(
            p.name.replace(/^NVIDIA (GeForce )?/, "").replace(/^Cisco /, ""),
            p.id,
          ),
      ),
  );
  layout = makeLayout(family);
  renderer?.chip_scene(JSON.stringify(layout));
  $("#chip-labels").replaceChildren(
    ...layout.blocks
      .filter((b) => b.label)
      .map((b) => {
        const el = document.createElement("span");
        el.className = "chip-label";
        el.dataset.region = b.region;
        el.textContent = b.title;
        return el;
      }),
  );
  setProfile($("#chip-profile").value);
  if (family === "switch")
    $("#scene-note").textContent = "Block one output. Let the others through.";
  if (comparing) {
    $("#brain-stimulus").hidden = family === "switch";
    $("#comparison-heading .eyebrow").textContent =
      family === "switch"
        ? "MOVING DATA · DIFFERENT MECHANISMS"
        : "SAME IMAGE · DIFFERENT MECHANISMS";
  }
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}${"#" + family}`,
  );
}
function showPanel(id, title, html) {
  if (!panels.has(id) && panels.size >= 7)
    panels.delete(panels.keys().next().value);
  panels.set(id, { title, html });
  currentPanel = id;
  if (id.startsWith("block:")) {
    selected = layout.blocks.find((b) => "block:" + b.key === id);
    renderer?.select(selected?.region ?? -1);
    dirty = true;
  }
  panel.hidden = false;
  $("#input-card").hidden = true;
  $("#packet-card").hidden = true;
  $("#display-settings").hidden = true;
  renderTabs();
  $("#inspection").innerHTML = html;
  if (id.startsWith("block:") && selected) renderBlock(selected, false);
  hdrText?.redraw();
}
function renderTabs() {
  $("#inspector-tabs").replaceChildren(
    ...[...panels].map(([id, p]) => {
      const b = document.createElement("button");
      b.textContent = p.title;
      b.dataset.panel = id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(id === currentPanel));
      b.onclick = () => showPanel(id, p.title, p.html);
      return b;
    }),
  );
}
function closePanel() {
  panel.hidden = true;
  $("#input-card").hidden = family === "switch";
  $("#packet-card").hidden = family !== "switch";
  hdrText?.redraw();
}
function sourceButton(s) {
  return `<button class="source-link" data-source="${escape(s.id)}">${escape(s.title)} ↗</button>`;
}
function comparisonSourceButton(s) {
  comparisonSources.set(s.id, s);
  return `<button class="source-link" data-comparison-source="${escape(s.id)}">${escape(s.title)} ↗</button>`;
}
function showComparisonSource(id) {
  const s = comparisonSources.get(id);
  if (!s) return;
  showPanel(
    "comparison-source:" + id,
    `${s.authors.split(" ")[0]} ${s.year}`,
    `<div class="eyebrow">FOLLOW THE EVIDENCE</div><h2>${escape(s.title)}</h2><p>${escape(s.authors)} · ${escape(s.year)}</p><dl><dt>Method and scope</dt><dd>${escape(s.method)} · ${escape(s.species)}</dd></dl><h3>What the source supports</h3><p>${escape(s.finding)}</p><p class="limit">${escape(s.limit)}</p><a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">Open the original source ↗</a>`,
  );
}
function showMechanisms() {
  if (!comparisonContent) return;
  const mechanisms = comparisonContent.mechanisms.filter((m) =>
    [family, "human"].includes(m.id),
  );
  const ids = [...new Set(mechanisms.flatMap((m) => m.sources))];
  showPanel(
    "comparison",
    "Compare",
    `<div class="eyebrow">COMPARE THE MECHANISMS</div><h2>What moves. What changes.</h2><p>${escape(comparisonContent.input.scope)}</p>${mechanisms.map((m) => `<h3>${escape(m.label)}</h3><dl><dt>Work</dt><dd>${escape(m.unit)}</dd><dt>Organization</dt><dd>${escape(m.organization)}</dd><dt>State</dt><dd>${escape(m.state)}</dd></dl><p>${escape(m.tradeoff)}</p><p class="limit">${escape(m.limit)}</p>`).join("")}<h3>Follow the evidence</h3>${ids.map((id) => comparisonSourceButton({ id, ...comparisonContent.sources[id] })).join("")}`,
  );
}
async function startComparison() {
  $("#compare-mechanisms").onclick = showMechanisms;
  $$("button[data-comparison-view]").forEach((b) => {
    b.onclick = () => {
      const view = b.dataset.comparisonView;
      document.body.dataset.comparisonView = view;
      closePanel();
      if (view === "brain") pause();
      else window.dokeBrainComparison?.pause();
      $$("button[data-comparison-view]").forEach((el) =>
        el.setAttribute("aria-pressed", String(el === b)),
      );
      dirty = true;
    };
  });
  window.addEventListener("doke-comparison-evidence", (event) => {
    const p = event.detail.panel;
    showPanel(
      p.id,
      p.title,
      `<div class="eyebrow">${escape(p.eyebrow)}</div><h2>${escape(p.title)}</h2>${p.paragraphs.map((t) => `<p>${escape(t)}</p>`).join("")}<h3>Follow the evidence</h3>${p.sources.map(comparisonSourceButton).join("")}`,
    );
  });
  try {
    const response = await fetch("comparison.json");
    if (!response.ok) throw Error("Comparison content unavailable");
    comparisonContent = await response.json();
    const { initBrainComparison } = await import("./brain-comparison.js");
    await initBrainComparison(wasm);
  } catch (error) {
    $("#brain-guide-copy").textContent =
      `The comparison could not open: ${error.message || error}`;
  }
}
function showReference() {
  showPanel(
    "reference",
    "Reference",
    `<div class="eyebrow">PUBLIC HARDWARE REFERENCE</div><h2>${escape(profile.name)}</h2><p>Choose a reference to inspect its documented features. The small execution model demonstrates the family’s mechanisms; these numbers do not set its timing.</p><dl>${profile.facts.map((f) => `<dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd>`).join("")}</dl><h3>What this view represents</h3>${profile.limits.map((l) => `<p class="limit">${escape(l)}</p>`).join("")}<h3>Follow the evidence</h3>${profile.sources.map(sourceButton).join("")}`,
  );
}
function showSource(id) {
  const source = catalog.profiles
    .flatMap((p) => p.sources)
    .find((s) => s.id === id);
  if (!source) return;
  const facts = profile.facts.filter((f) => f.source === id);
  showPanel(
    "source:" + id,
    "Source",
    `<div class="eyebrow">SOURCE RECORD</div><h2>${escape(source.title)}</h2><p>Checked ${escape(source.checked)}. Public source; original publisher retains its rights.</p>${facts.map((f) => `<h3>${escape(f.label)}</h3><p>${escape(f.value)}</p><p class="small">${escape(f.locator)}</p>`).join("")}<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">Open the original source ↗</a><p class="limit">Product specifications are reference facts, not measurements from this model run.</p>`,
  );
}
function showModel() {
  const body =
    family === "switch"
      ? `<p>The deterministic 3 × 3 input-queued switch holds at most 32 fixed-size packets, including transfers. One grant per input and output can occur per model tick. A blocked output holds its transfer until released.</p><p>FIFO can trap packets behind another destination. VOQ separates destinations. Changing the queue mode preserves packet identity and canonical per-input order.</p><dl><dt>Conservation</dt><dd>${snap.attempted} attempted = ${snap.dropped} dropped + ${snap.delivered} delivered + ${snap.occupied} held</dd></dl><p>This is an original generic scheduler. It does not reproduce a Cisco pipeline, HBM buffer size, PFC or ECN implementation.</p>`
      : `<p>Your 8 × 8 matrix A is multiplied by a fixed difference matrix B. Each of 64 output cells accumulates eight signed integer products. Every mode performs 512 useful MACs and must produce the same result.</p><p>${family === "cpu" ? "Independent output dot products share a two-issue scheduler and a small LRU cache. Operands must return before a MAC. This is not x86 instruction emulation." : family === "gpu" ? "Two logical 32-lane warps issue address-based loads. Unique 32-byte sectors determine the requested traffic. The selected warp is enlarged in the schematic; no actual GPU kernel is being benchmarked." : "Four output tiles run through a 4 × 4 output-stationary array. Real operand registers pass A east and B south; each cell accumulates matching products. This is not Google’s MXU microarchitecture."}</p><p class="limit">Model ticks and memory traffic describe the declared toy rules. They are not measured chip cycles, bandwidth, energy or a prediction for this SKU.</p><h3>Rules for this run</h3><table>${Object.entries(
          snap.rules,
        )
          .map(
            ([k, v]) =>
              `<tr><th>${escape(k.replaceAll("_", " "))}</th><td>${escape(v)}</td></tr>`,
          )
          .join("")}</table>`;
  showPanel(
    "model",
    "Model",
    `<div class="eyebrow">WHAT IS CALCULATED</div><h2>${family === "switch" ? "Traffic with consequences." : "The numbers make the light."}</h2>${body}`,
  );
}
function renderBlock(block, open = true) {
  if (!block) return;
  const node = snap.nodes?.find((n) => n.id === block.key);
  const packets =
    family === "switch"
      ? snap.packets.filter(
          (p) => resolveBlock(layout, p.node)?.key === block.key,
        )
      : [];
  const html = `<div class="eyebrow">INSIDE THE MODEL</div><h2>${escape(block.title)}</h2><p>${escape(block.description)}</p>${node ? `<dl><dt>Current state</dt><dd>${escape(node.state)}</dd><dt>Modeled occupancy</dt><dd>${node.occupancy} / ${node.capacity}</dd></dl>` : ""}${
    family === "switch"
      ? `<dl><dt>Packets held here</dt><dd>${packets.length}</dd></dl>${packets
          .slice(0, 12)
          .map(
            (p) =>
              `<p class="small">Packet ${p.id} → ${"ABC"[p.egress]} · age ${p.age_ticks} ticks</p>`,
          )
          .join("")}`
      : ""
  }<p class="limit">Position and size make the functional relationships legible. They are not the selected product’s physical floorplan.</p>`;
  if (open) {
    selected = block;
    renderer?.select(block.region);
    showPanel("block:" + block.key, block.title, html);
  } else {
    $("#inspection").innerHTML = html;
    panels.set(currentPanel, { title: block.title, html });
  }
}
function rendererState() {
  if (!renderer || !snap) return;
  const activity = new Float32Array(64),
    flows = [];
  if (family === "switch") {
    for (const p of snap.packets) {
      const b = resolveBlock(layout, p.node);
      if (b) activity[b.region] = Math.min(0.95, activity[b.region] + 0.2);
    }
    for (const e of snap.events
      .filter(
        (e) =>
          e.tick === snap.tick &&
          ["transfer", "deliver", "admit"].includes(e.kind),
      )
      .slice(-32)) {
      const a = resolveBlock(layout, e.from),
        b = resolveBlock(layout, e.to);
      if (a && b) {
        activity[a.region] = 0.75;
        activity[b.region] = 0.6;
        flows.push(
          ...[a.position[0], a.position[1] + 0.14, a.position[2]],
          ...[b.position[0], b.position[1] + 0.14, b.position[2]],
          tickPhase,
        );
      }
    }
  } else {
    for (const n of snap.nodes) {
      const b = resolveBlock(layout, n.id);
      if (b)
        activity[b.region] =
          n.state === "busy"
            ? 0.9
            : n.occupancy
              ? Math.min(
                  0.7,
                  0.2 + (0.5 * n.occupancy) / Math.max(1, n.capacity),
                )
              : 0.025;
    }
    for (const l of snap.lanes || []) {
      const b = resolveBlock(
        layout,
        (family === "gpu" ? "lane" : "pe") + l.lane,
      );
      if (b && l.active) activity[b.region] = 0.95;
    }
    const active = snap.transfers
      .filter((t) => t.start_tick <= snap.tick && t.end_tick > snap.tick)
      .slice(-32);
    for (const t of active) {
      const a = resolveBlock(layout, t.from),
        b = resolveBlock(layout, t.to);
      if (!a || !b) continue;
      const phase = Math.min(
        1,
        (snap.tick - t.start_tick + (reduced ? 0.5 : tickPhase)) /
          Math.max(1, t.end_tick - t.start_tick),
      );
      flows.push(
        a.position[0],
        a.position[1] + 0.14,
        a.position[2],
        b.position[0],
        b.position[1] + 0.14,
        b.position[2],
        phase,
      );
      activity[a.region] = Math.max(activity[a.region], 0.35);
    }
  }
  renderer.activity(activity);
  renderer.chip_flows(new Float32Array(flows));
}
function labels() {
  if (!renderer || !layout) return;
  const r = canvas.getBoundingClientRect();
  const obstacles = [
    "header",
    ".chip-heading",
    "#input-card",
    "#output-card",
    "#packet-card",
    "#inspector",
    ".bottom-area",
  ]
    .map((s) => $(s))
    .filter((e) => e && !e.hidden)
    .map((e) => e.getBoundingClientRect());
  $$("#chip-labels .chip-label").forEach((el) => {
    const b = layout.blocks.find((b) => b.region === +el.dataset.region);
    const p = renderer.project(
      b.position[0],
      b.position[1] + b.size[1] / 2 + 0.08,
      b.position[2],
    );
    el.style.left = `${(p[0] / canvas.width) * r.width}px`;
    el.style.top = `${(p[1] / canvas.height) * r.height}px`;
    el.hidden = false;
    const bounds = el.getBoundingClientRect();
    el.hidden =
      p[2] < 0 ||
      p[2] > 1 ||
      obstacles.some(
        (o) =>
          bounds.right > o.left &&
          bounds.left < o.right &&
          bounds.bottom > o.top &&
          bounds.top < o.bottom,
      );
  });
}
function resize() {
  const r = canvas.getBoundingClientRect(),
    d = Math.min(devicePixelRatio || 1, 1.75);
  canvas.width = Math.max(1, Math.round(r.width * d));
  canvas.height = Math.max(1, Math.round(r.height * d));
  renderer?.resize(canvas.width, canvas.height);
  dirty = true;
  hdrText?.redraw();
}
function updateLight() {
  const light = $("#light-mode").value;
  const active = configureHDR(canvas, renderer, light === "auto");
  renderer?.hdr_output(active);
  renderer?.glow(light === "quiet" ? 0.25 : 1.6);
  if (!active && hdrText) {
    hdrText.destroy();
    hdrText = null;
  }
  if (active && !hdrText) {
    try {
      hdrText = new HDRText(
        canvas.getContext("webgpu").getConfiguration().device,
      );
    } catch {}
  }
  $("#light-status").textContent = active
    ? "Extended-range canvas active. Brightness depends on the display."
    : "SDR contrast and bloom. Display brightness range is unchanged.";
  hdrText?.redraw();
  dirty = true;
}
function bind() {
  $$(".families button").forEach(
    (b) => (b.onclick = () => changeFamily(b.dataset.family)),
  );
  $("#chip-profile").onchange = (e) => setProfile(e.target.value);
  $("#run").onclick = () => {
    if (playing) pause();
    else {
      if (snap.status === "complete") resetModel();
      playing = true;
      accumulator = 0;
      updateControls();
    }
  };
  $("#step").onclick = () => {
    pause();
    advance(1);
    tickPhase = 0.5;
  };
  $("#reset").onclick = resetModel;
  $("#finish").onclick = finish;
  $("#memory-layout").onchange = () => {
    resetModel();
    toast("Same input. A new physical address layout.");
  };
  $("#cache-enabled").onchange = resetModel;
  $("#queue-mode").onchange = () => {
    pause();
    snapshotFrom(model.queue_mode($("#queue-mode").value));
  };
  for (let i = 0; i < 3; i++) {
    $("#inject-" + i).onclick = () => snapshotFrom(model.inject(i, 6));
    $("#block-" + i).onclick = () =>
      snapshotFrom(model.block(i, !snap.blocked[i]));
  }
  $("#input-preset").onchange = (e) => {
    input = pattern(e.target.value);
    resetModel();
  };
  const tile = $("#input-tile");
  tile.onpointerdown = (e) => {
    if (e.button !== 0) return;
    tile.focus();
    const r = tile.getBoundingClientRect();
    brush = Math.min(
      63,
      Math.max(
        0,
        Math.floor(((e.clientY - r.top) / r.height) * 8) * 8 +
          Math.floor(((e.clientX - r.left) / r.width) * 8),
      ),
    );
    paint = { value: input[brush] ? 0 : 7 };
    tile.setPointerCapture(e.pointerId);
    editAt(e);
  };
  tile.onpointermove = (e) => {
    if (paint) editAt(e);
  };
  tile.onpointerup = () => (paint = false);
  tile.onpointercancel = () => (paint = false);
  tile.onkeydown = (e) => {
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)
    ) {
      e.preventDefault();
      if (e.key === " ") {
        input[brush] = input[brush] ? 0 : 7;
        resetModel();
      } else {
        brush =
          (brush +
            { ArrowLeft: 63, ArrowRight: 1, ArrowUp: 56, ArrowDown: 8 }[
              e.key
            ]) %
          64;
        drawTiles();
      }
    }
  };
  tile.onfocus = tile.onblur = drawTiles;
  $("#hide-input").onclick = () => {
    $("#input-body").hidden = !$("#input-body").hidden;
    $("#hide-input").textContent = $("#input-body").hidden ? "+" : "−";
  };
  $("#reference").onclick = showReference;
  $("#inspect-model").onclick = showModel;
  $("#close-inspector").onclick = closePanel;
  $("#inspection").onclick = (e) => {
    const b = e.target.closest("[data-source]");
    if (b) showSource(b.dataset.source);
    const comparisonSource = e.target.closest("[data-comparison-source]");
    if (comparisonSource)
      showComparisonSource(comparisonSource.dataset.comparisonSource);
  };
  $("#settings").onclick = () => {
    $("#display-settings").hidden = !$("#display-settings").hidden;
  };
  $("#light-mode").onchange = updateLight;
  $("#reduce-motion").checked = reduced;
  $("#reduce-motion").onchange = (e) => {
    reduced = e.target.checked;
    if (reduced) pause();
    dirty = true;
  };
  $("#zoom-in").onclick = () => {
    renderer?.zoom(-0.15);
    dirty = true;
  };
  $("#zoom-out").onclick = () => {
    renderer?.zoom(0.15);
    dirty = true;
  };
  $("#reset-camera").onclick = () => {
    renderer?.view(0);
    dirty = true;
  };
  canvas.onpointerdown = (e) => {
    if (e.button !== 0) return;
    drag = {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4)
      drag.moved = true;
    renderer?.orbit(dx * 0.005, dy * 0.005);
    drag.x = e.clientX;
    drag.y = e.clientY;
    dirty = true;
  };
  canvas.onpointerup = (e) => {
    if (drag && !drag.moved && renderer) {
      const r = canvas.getBoundingClientRect(),
        id = renderer.pick(
          (e.clientX - r.left) / r.width,
          (e.clientY - r.top) / r.height,
        );
      renderBlock(layout.blocks.find((b) => b.region === id));
      dirty = true;
    }
    drag = null;
  };
  canvas.onpointercancel = () => (drag = null);
  canvas.onwheel = (e) => {
    e.preventDefault();
    renderer?.zoom(Math.max(-0.2, Math.min(0.2, e.deltaY * 0.001)));
    dirty = true;
  };
  canvas.onkeydown = (e) => {
    const move = {
      ArrowLeft: [-0.1, 0],
      ArrowRight: [0.1, 0],
      ArrowUp: [0, -0.1],
      ArrowDown: [0, 0.1],
    }[e.key];
    if (move) {
      e.preventDefault();
      renderer?.orbit(...move);
    } else if (e.key === "+" || e.key === "=") renderer?.zoom(-0.15);
    else if (e.key === "-") renderer?.zoom(0.15);
    else if (e.key === "Enter") showModel();
    dirty = true;
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePanel();
      $("#display-settings").hidden = true;
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    last = 0;
  });
  new ResizeObserver(resize).observe($("#silicon-stage"));
}
function frame(time) {
  const dt = last ? Math.min(0.08, (time - last) / 1000) : 0;
  last = time;
  if (!document.hidden) {
    if (playing && model) {
      accumulator += dt * tickRates[family] * (+$("#pace").value / 24);
      const count = Math.min(256, Math.floor(accumulator));
      accumulator -= count;
      if (count) advance(count);
      tickPhase = accumulator;
      dirty = true;
    }
    if (dirty && renderer) {
      try {
        rendererState();
        renderer.render(0);
        labels();
      } catch (e) {
        pause();
        $("#render-status").textContent =
          "Graphics interrupted · reload to restore";
        console.warn(e);
        renderer = null;
      }
    }
    dirty = false;
  }
  requestAnimationFrame(frame);
}
async function boot() {
  try {
    catalog = await fetch("hardware.json").then((r) => {
      if (!r.ok) throw Error("Reference catalog unavailable");
      return r.json();
    });
    wasm = await import("./pkg/doke.js");
    await wasm.default();
    resize();
    const forceGL =
      !navigator.gpu ||
      new URLSearchParams(location.search).get("backend") === "webgl";
    try {
      renderer = await wasm.BrainRenderer.create(canvas, forceGL, hdrCapable());
    } catch (e) {
      if (!forceGL) {
        const replacement = canvas.cloneNode();
        canvas.replaceWith(replacement);
        canvas = replacement;
        resize();
        renderer = await wasm.BrainRenderer.create(canvas, true, false);
      } else throw e;
    }
    updateLight();
    resize();
    $("#loading").hidden = true;
    $("#render-status").textContent =
      `${renderer.backend()} · original schematic`;
  } catch (e) {
    $("#loading").classList.add("error");
    $("#loading").textContent =
      `3D is unavailable. ${e.message || e} The numerical controls remain available when the model has loaded.`;
    $("#render-status").textContent = "Numerical model · 3D unavailable";
    console.warn(e);
  }
  if (wasm && catalog) {
    bind();
    changeFamily(
      ["cpu", "gpu", "tensor", "switch"].includes(location.hash.slice(1))
        ? location.hash.slice(1)
        : "gpu",
    );
  }
  document.documentElement.dataset.ready = "true";
  requestAnimationFrame(frame);
  if (comparing && wasm) startComparison();
}
window.dokeSilicon = {
  snapshot: () => (snap ? structuredClone(snap) : null),
  finish,
  reset: resetModel,
  input: () => [...input],
  family: () => family,
  inspect: showPanel,
  getRenderer: () => renderer,
  getWasm: () => wasm,
};
boot();
