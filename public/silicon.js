import { hdrCapable, configureHDR, HDRText } from "./display.js";
import { timingPanel } from "./timescales-view.js";
import { makeLayout, resolveBlock } from "./silicon-layouts.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pretty = (n) => Number(n).toLocaleString();
let wasm,
  renderer,
  hdrText,
  architecture,
  brainContent,
  comparison,
  timescales,
  brain,
  brainPromise,
  model,
  snap,
  layout;
let world = "gpu",
  family = "gpu",
  level = "processor",
  profile = "rtx-5090",
  selectedUnit = 0,
  pinnedOutput = 0;
let comparing = new URLSearchParams(location.search).get("compare") === "1",
  guideVisible = false;
let playing = false,
  reduced = matchMedia("(prefers-reduced-motion: reduce)").matches,
  last = 0,
  accumulator = 0,
  phase = 0.5,
  dirty = true,
  drag,
  paint,
  brush = 0;
let operation = "difference",
  queueMode = "voq";
const defaults = {
  cpu: "ryzen-9950x",
  gpu: "rtx-5090",
  tensor: "tpu-v1",
  switch: "silicon-one-g200",
};
const familyNames = { cpu: "CPU", gpu: "GPU", tensor: "NPU", switch: "ASIC" };
let cacheEnabled = true,
  memoryLayout = "packed",
  speed = 1,
  input = pattern("diagonal"),
  canvas = $("#chip-canvas");
let tabs = new Map(),
  currentTab = null,
  liveRefresh = 0,
  transition = null;
const chipPointers = new Map();
let pinch = null;
const sources = new Map(),
  reader = $("#reader");
function pattern(id) {
  return Array.from({ length: 64 }, (_, i) =>
    id === "clear"
      ? 0
      : id === "stripes"
        ? (i % 8) % 3 === 1
          ? 7
          : 0
        : id === "checker"
          ? (Math.floor(i / 8) + (i % 8)) % 2
            ? 7
            : 0
          : Math.abs(Math.floor(i / 8) - (i % 8)) < 2
            ? 7
            : 0,
  );
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2400);
}
function sourceButtons(ids, prefix = "chip") {
  return (ids || [])
    .map((id) => {
      const s = sources.get(prefix + ":" + id);
      return s
        ? `<button class="source-link" data-source="${esc(prefix + ":" + id)}">${esc(s.title)} ↗</button>`
        : "";
    })
    .join("");
}
function openPanel(id, title, render, live = false) {
  tabs.set(id, { title, render, live });
  if (tabs.size > 7) tabs.delete(tabs.keys().next().value);
  if (currentTab !== id) $("#inspection").scrollTop = 0;
  currentTab = id;
  reader.hidden = false;
  $("#settings").hidden = true;
  renderTabs();
  renderPanel();
  dirty = true;
}
function renderTabs() {
  $("#reader-tabs").innerHTML = [...tabs]
    .map(
      ([id, t]) =>
        `<button role="tab" aria-selected="${id === currentTab}" data-tab="${esc(id)}">${esc(t.title)}</button>`,
    )
    .join("");
  $("#reader-tabs [aria-selected=true]")?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}
function renderPanel() {
  const t = tabs.get(currentTab);
  if (!t) return;
  const old = $("#inspection").scrollTop;
  $("#inspection").innerHTML = t.render();
  $("#inspection").scrollTop = old;
  bindPanel();
  drawTiles();
  hdrText?.redraw();
}
function closePanel() {
  reader.hidden = true;
  dirty = true;
  hdrText?.redraw();
}
function showSource(key) {
  const s = sources.get(key);
  if (!s) return;
  openPanel(
    "source:" + key,
    "Source",
    () =>
      `<span class="eyebrow">FOLLOW THE EVIDENCE</span><h2>${esc(s.title)}</h2>${s.authors ? `<p>${esc(s.authors)} · ${esc(s.year)}</p>` : ""}${s.locator ? `<p>${esc(s.locator)}</p>` : ""}${s.finding ? `<p>${esc(s.finding)}</p>` : ""}${s.scope ? `<p class="limit">${esc(s.scope)}</p>` : ""}${s.limit ? `<p class="limit">${esc(s.limit)}</p>` : ""}<a class="action" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Read the original source ↗</a><p class="muted">Your previous view stays in the tabs above.</p>`,
  );
}
function profileData() {
  return architecture.profiles[profile];
}

function showOverview() {
  if (world === "brain") {
    showBrainEvidence();
    return;
  }
  const f = family,
    p = profileData(),
    lev = level,
    blocks = layout.blocks,
    note = layout.detailNote,
    desc = architecture.families[f].levels.find((l) => l.id === lev);
  const title =
    lev === "processor"
      ? "Processor"
      : lev === "core"
        ? { cpu: "Core", gpu: "SM", tensor: "Array", switch: "Packet path" }[f]
        : "Execution";
  openPanel(
    `overview:${f}:${lev}`,
    title,
    () =>
      `<span class="eyebrow">${lev === "execution" ? "EXECUTABLE TEACHING MODEL" : "SOURCE-LINKED ARCHITECTURE"}</span><h2>${esc(desc.title)}</h2><p>${esc(desc.description)}</p><p>${esc(architecture.families[f].overview)}</p><p class="limit">${esc(note)}</p>${lev === "processor" ? `<dl>${p.facts.map((x) => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join("")}</dl><p class="limit">${esc(p.topology_note)}</p><button class="action" data-enter="core">Explore the internals ↘</button>` : lev === "core" ? `<p>Choose a component to explore its role, connections and sources.</p><button class="action" data-enter="execution">${f === "switch" ? "Follow a packet" : "Follow an actual value"} ↘</button>` : `<p>${f === "switch" ? "Eighteen packets begin in a three-port teaching switch. Each tick delivers prior transfers, then arbitrates new requests. Block an output or change FIFO to virtual output queues and inspect which packets can progress." : "An 8 × 8 input matrix A is multiplied by B. Each output accumulates eight integer products. CPU, GPU and tensor schedules produce the same exact result. Choose the matrix transform in Input."}</p><p class="limit">Timing and resource limits are authored teaching rules. Reference chip clocks and bandwidth do not calibrate this model.</p><button class="action" data-value="${pinnedOutput}">${f === "switch" ? "Inspect packet traffic" : "Inspect a value"} →</button><label class="inline-controls">Playback speed <select id="pace"><option value="0.25">¼×</option><option value="1">1×</option><option value="4">4×</option></select></label>`}${lev !== "execution" ? `<details><summary>Find a component</summary>${blocks.map((b) => `<button class="source-link" data-inspect-level="${lev}" data-inspect="${esc(b.key)}">${esc(b.title)} →</button>`).join("")}</details>` : ""}${sourceButtons(p.sources)}`,
  );
}

function showBlock(b) {
  if (!b) return;
  const f = family,
    lev = level,
    content = architecture.families[f].blocks[b.architecture];
  renderer?.select(b.region);
  dirty = true;
  if (!content) return;
  const id = `block:${f}:${lev}:${b.key}`;
  openPanel(
    id,
    b.title,
    () =>
      `<span class="eyebrow">${lev === "execution" ? "EXECUTED MODEL COMPONENT" : "INSIDE THE " + familyNames[f]}</span><h2>${esc(b.title)}</h2><p>${esc(content.summary)}</p>${content.detail.map((t) => `<p>${esc(t)}</p>`).join("")}<h3>Where it fits</h3><p>${esc(content.path.join(" → "))}</p><p class="limit">${esc(content.modelNote)}${lev === "core" ? " Highlighted activity represents one teaching-model resource; it does not distribute or schedule work across these schematic components." : ""}</p>${b.enter ? `<button class="action" data-enter="${b.enter}" data-unit="${b.unit ?? selectedUnit}">Enter ${b.enter === "core" ? (f === "cpu" ? "core " + ((b.unit ?? 0) + 1) : f === "gpu" ? "SM " + ((b.unit ?? 0) + 1) : f === "tensor" ? "the matrix unit" : "the packet path") : "the execution model"} ↘</button>` : ""}${Number.isInteger(b.lane) ? `<button class="action" data-follow-lane="${b.lane}">Follow this lane’s output →</button>` : ""}${lev === "execution" ? '<button class="action" data-state>Inspect live machine state →</button>' : ""}${sourceButtons(content.sources)}`,
  );
}
function outputForLane(index) {
  return (
    snap.lanes?.find((l) => l.lane === index)?.output_index ??
    (family === "tensor"
      ? Math.floor((snap.group_index || 0) / 2) * 32 +
        Math.floor(index / 4) * 8 +
        ((snap.group_index || 0) % 2) * 4 +
        (index % 4)
      : (snap.group_index || 0) * 32 + index)
  );
}
function trafficBody() {
  return `<span class="eyebrow">LIVE PACKETS · TICK ${snap.tick}</span><h2>Where can this packet go?</h2><p>Three inputs and outputs share 32 packet slots. Change a destination's availability and watch the queue consequences.</p><label class="inline-controls">Queue discipline<select id="queue-mode"><option value="voq">Virtual output queues</option><option value="fifo">One FIFO per input</option></select></label><div class="traffic-ports">${[0, 1, 2].map((i) => `<div><span>Output ${"ABC"[i]}</span><button data-inject="${i}">Send 6</button><button data-block="${i}" aria-pressed="${snap.blocked[i]}">${snap.blocked[i] ? "Unblock" : "Block"}</button></div>`).join("")}</div><dl><dt>Delivered / admitted</dt><dd>${snap.delivered} / ${snap.admitted}</dd><dt>Buffered / in flight</dt><dd>${snap.buffered} / ${snap.in_flight}</dd><dt>Rejected because the buffer was full</dt><dd>${snap.dropped}</dd></dl><h3>Actual queues</h3>${snap.queues.map((q) => `<p class="packet-queue"><b>${esc(q.node)}</b><span>${q.packet_ids.map((id) => `<i>#${id}</i>`).join("") || "empty"}</span></p>`).join("")}<p class="limit">This bounded model explains queueing and contention. Its three ports, 32 slots, arbitration and tick latency are authored; they are not G200's internal resources or latency.</p>`;
}
function showTraffic() {
  openPanel("traffic", "Packet traffic", trafficBody, true);
}
function renderFabric() {
  const activity = new Float32Array(256),
    flows = [];
  for (const p of snap.packets) {
    const b = resolveBlock(layout, p.node);
    if (b) activity[b.region] = Math.min(0.85, activity[b.region] + 0.18);
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
    if (!a || !b) continue;
    activity[a.region] = 0.65;
    activity[b.region] = Math.max(activity[b.region], 0.4);
    flows.push(
      a.position[0],
      a.position[1] + 0.14,
      a.position[2],
      b.position[0],
      b.position[1] + 0.14,
      b.position[2],
      reduced ? 0.5 : phase,
    );
  }
  renderer.activity(activity);
  renderer.chip_flows(new Float32Array(flows));
}
function showInput() {
  if (family === "switch") {
    showTraffic();
    return;
  }
  openPanel(
    "input",
    "Input",
    () =>
      `<span class="eyebrow">SAME INPUT · DIFFERENT SCHEDULE</span><h2>Make a pattern.</h2><p>Draw on the left. Follow its values through memory and arithmetic. Click an output square to inspect every product that built it.</p><div class="tile-pair"><div><div class="eyebrow">INPUT · A</div><canvas id="input-tile" width="256" height="256" tabindex="0" aria-label="Editable 8 by 8 input. Arrow keys move; Space toggles a cell."></canvas><p>Click or drag to paint.</p></div><div><div class="eyebrow">OUTPUT · C</div><canvas id="output-tile" width="256" height="256" tabindex="0" aria-label="Output values. Arrow keys move; Enter inspects selected output."></canvas><p id="output-count"></p></div></div><label class="inline-controls">Operation<select id="operation"><option value="difference">Find edges · A × B</option><option value="mix">Weighted neighbors · A × B</option><option value="identity">Copy · A × I</option></select></label><label class="inline-controls">Pattern<select id="input-preset"><option value="custom">Custom</option><option value="diagonal">Diagonal</option><option value="stripes">Stripes</option><option value="checker">Checker</option><option value="clear">Clear</option></select></label>${family === "cpu" ? `<label class="inline-controls">Four-line model cache<input type="checkbox" id="cache-enabled" ${cacheEnabled ? "checked" : ""}></label>` : family === "gpu" ? `<label class="inline-controls">Operand B addresses<select id="memory-layout"><option value="packed">Contiguous</option><option value="strided">Strided</option></select></label><p class="muted">Strided storage puts B in column-major order. Adjacent output lanes request values 32 bytes apart. Logical values stay identical; more 32-byte sectors may be requested.</p>` : `<p class="muted">Operand tiles stream through a 4 × 4 array. Adjacent cells reuse values while accumulating each output.</p>`}<button class="action" data-value="${pinnedOutput}">Follow output ${pinnedOutput} →</button><p class="limit">These small matrix transforms demonstrate data movement. The model does not recognize images or predict what a person perceives.</p>`,
  );
}
function valueBody() {
  const o = snap.detail.outputs[pinnedOutput],
    job = snap.detail.cpu_jobs.find((j) => j.output_index === pinnedOutput),
    warp = snap.detail.warps.find((w) =>
      w.lanes.some((l) => l.output_index === pinnedOutput),
    );
  const tensorState =
    family === "tensor"
      ? {
          stage: o.stored
            ? "stored"
            : o.retired_terms === 8
              ? "waiting_store"
              : o.retired_terms
                ? "accumulating"
                : "awaiting wave",
          reason:
            "Operands travel between neighboring cells in the teaching array. Only completed products appear below.",
        }
      : null;
  const active =
      family === "cpu" ? job : family === "tensor" ? tensorState : warp,
    lane = warp?.lanes.find((l) => l.output_index === pinnedOutput),
    operands = family === "cpu" ? job : lane;
  return `<span class="eyebrow">ACTUAL MODEL STATE · TICK ${snap.tick}</span><h2>One value, eight products.</h2><label class="inline-controls">Output <select id="pinned-output">${Array.from({ length: 64 }, (_, i) => `<option value="${i}" ${i === pinnedOutput ? "selected" : ""}>C[${Math.floor(i / 8)}, ${i % 8}] · ${i}</option>`).join("")}</select></label><div class="term-value">${o.accumulated_sum}</div><p>${o.stored ? "Completed and stored." : o.retired_terms === 8 ? "All products complete; the store is still pending." : `${o.retired_terms} of 8 products have completed.`}</p><span class="state-tag">${esc(active?.stage || "awaiting work")}</span><p>${esc(active?.reason || "This output has not entered the visible work group yet.")}</p>${operands ? `<div class="equation">A ${operands.a ?? "…"} × B ${operands.b ?? "…"}</div><p class="muted">Loaded operands · ${operands.a_address == null ? "no pending address" : `addresses ${operands.a_address} and ${operands.b_address} bytes`}</p>` : ""}<table aria-label="Completed products"><thead><tr><th>k</th><th>A × B</th><th>Product</th><th>Sum</th></tr></thead><tbody>${Array.from(
    { length: 8 },
    (_, k) => {
      const t = o.terms.find((t) => t.k === k);
      return `<tr><td>${k}</td>${t ? `<td>${t.a} × ${t.b}</td><td>${t.product}</td><td>${t.sum_after}</td>` : '<td class="waiting" colspan="3">not completed</td>'}</tr>`;
    },
  ).join(
    "",
  )}</tbody></table><p class="muted">Only completed arithmetic appears here. The final output becomes visible after its modeled store completes.</p><button class="action" data-state>Inspect ${family === "cpu" ? "cache and work queue" : family === "tensor" ? "the operand wave" : "warp and memory sectors"} →</button>`;
}
function showValue(id) {
  if (family === "switch") {
    showTraffic();
    return;
  }
  pinnedOutput = Math.max(0, Math.min(63, Number(id) || 0));
  openPanel("value", "Follow a value", valueBody, true);
}
function stateBody() {
  if (family === "switch") return trafficBody();
  const d = snap.detail;
  return `<span class="eyebrow">LIVE MODEL STATE · TICK ${snap.tick}</span><h2>What is waiting?</h2>${
    family === "cpu"
      ? `<h3>Cache · ${d.cache.enabled ? "enabled" : "bypassed"}</h3><p>${d.cache.capacity_lines} model lines × ${d.cache.line_bytes} bytes. Least recently used first.</p><div class="sector-grid">${d.cache.lru_to_mru.map((l) => `<span>line ${l.tag} · byte ${l.base_address}</span>`).join("") || "<span>empty</span>"}</div><p>${d.cache.pending_fills.map((f) => `Line ${f.tag} arrives at tick ${f.arrival_tick}.`).join(" ") || "No pending line fills."}</p><h3>Independent outputs</h3>${
          d.cpu_jobs
            .filter((j) => j.stage !== "stored")
            .slice(0, 8)
            .map(
              (j) =>
                `<button class="source-link" data-value="${j.output_index}">C[${Math.floor(j.output_index / 8)},${j.output_index % 8}] · ${esc(j.stage)}<br><span class="muted">${esc(j.reason)}</span></button>`,
            )
            .join("") || "<p>All outputs stored.</p>"
        }`
      : family === "tensor"
        ? `<h3>4 × 4 teaching array</h3><p>Tile ${(snap.group_index ?? 0) + 1} of 4. Each output is an eight-product dot product. Values move right and down between neighboring processing elements.</p><div class="sector-grid">${snap.lanes.map((l) => `<span>PE ${l.lane + 1} · ${l.output_index == null ? "idle" : `C${l.output_index} = ${d.outputs[l.output_index].accumulated_sum}`}</span>`).join("")}</div>`
        : `${d.warps.map((w) => `<h3>Warp ${w.warp} · k = ${w.k}</h3><span class="state-tag">${esc(w.stage)}</span><p>${esc(w.reason)}</p><p class="muted">Requested 32-byte sectors for the current operand step</p><div class="sector-grid">${[...w.requested_a_sectors.map((s) => "A " + s), ...w.requested_b_sectors.map((s) => "B " + s)].map((s) => `<span>${esc(s)}</span>`).join("") || "<span>none requested</span>"}</div>`).join("")}`
  }<h3>Completed work</h3><dl><dt>Integer multiply-adds</dt><dd>${snap.counters.macs} / 512</dd><dt>Modeled bytes transferred</dt><dd>${pretty(snap.counters.bytes_moved)}</dd><dt>Output values stored</dt><dd>${snap.counters.completed_outputs} / 64</dd></dl><p class="limit">These are teaching-model transactions, not measurements of ${esc(profileData().name)}.</p>`;
}
function showState() {
  openPanel("state", "Machine state", stateBody, true);
}
function showAbout() {
  openPanel(
    "about",
    "Evidence",
    () =>
      `<span class="eyebrow">FOLLOW THE EVIDENCE</span><h2>Inside the computation.</h2><p>Explore documented processor structures, follow a calculation through an executable teaching model, and locate the human brain's visual anatomy.</p><p>Processor counts and architectural roles come from AMD, NVIDIA, Google and Cisco documentation. Geometry is an original functional schematic: positions, areas and wiring do not reproduce a physical die.</p><p>Model latencies, cache capacity and issue rules are deliberately small and authored. Product selection changes architectural context; it does not turn the model into a benchmark of that chip.</p><p>Brain anatomy comes from a human reference atlas. Its pathway guide highlights landmarks at an authored reading pace. It predicts neither neural firing nor your perception.</p><p class="limit">A model tick, a hardware cycle and a physiological response time are different quantities. doke does not claim a CPU-versus-brain speed ranking.</p>${sourceButtons(profileData().sources)}${sourceButtons(["allen"], "brain")}<details><summary>Data attribution and licenses</summary><p>${esc(brain?.getAtlas?.()?.attribution || "Anatomical meshes derived from the Allen Human Reference Atlas, Ding and colleagues, 2020.")}</p><a href="assets/NOTICE.md" target="_blank" rel="noopener">Atlas attribution</a> · <a href="licenses/rust-dependencies.txt" target="_blank" rel="noopener">Software notices</a></details>`,
  );
}
function showBrainEvidence() {
  showTiming();
}
function showTiming() {
  const p = profileData();
  openPanel(
    "timing:" + profile,
    "Timing & parts",
    () =>
      timingPanel(timescales, p, sourceButtons) +
      `<details><summary>About the atlas guide</summary><p>${esc(comparison.brain.scope)}</p><p>${family === "switch" ? "Packet routing and visual anatomy are independent demonstrations." : esc(comparison.input.scope)}</p>${sourceButtons(comparison.evidenceSourceIds, "comparison")}</details>`,
  );
}

function showAnatomy() {
  openPanel(
    "anatomy",
    "Anatomy",
    () =>
      `<span class="eyebrow">HUMAN REFERENCE ATLAS</span><h2>Explore the anatomy.</h2><p>Choose a region to locate its surface and read the evidence.</p><input id="region-search" class="region-search" placeholder="Find a region" aria-label="Find an anatomical region"><div id="region-list">${
        (brain?.getAtlas()?.regions || [])
          .filter((r) => brainContent.regions[r.id])
          .map(
            (r) =>
              `<button class="region-link" data-region="${esc(r.id)}">${esc(r.name)} ↗</button>`,
          )
          .join("") || "<p>The reference atlas is still loading.</p>"
      }</div>`,
  );
}
function showRegion(id, region) {
  const c = brainContent.regions[id];
  openPanel(
    "brain-region:" + id,
    region.name,
    () =>
      `<span class="eyebrow">ANATOMICAL CONTEXT</span><h2>${esc(region.name)}</h2><p>${esc(c?.summary || region.description || "An anatomical group in the human reference atlas.")}</p><button class="action" data-focus-region="${esc(id)}">Focus the camera here ↗</button><p class="limit">Reference anatomy, not a scan of an individual or a measured response to the input image.</p>${sourceButtons(c?.sources || ["allen"], "brain")}`,
  );
}
function showCutaway() {
  openPanel(
    "cutaway",
    "Look inside",
    () =>
      `<span class="eyebrow">ANATOMICAL LAYERS</span><h2>Beyond the surface.</h2><p>Reveal one hemisphere or the deep structures. This hides atlas meshes; it is not a surgical section.</p>${[
        ["whole", "Whole brain"],
        ["left", "Left hemisphere"],
        ["right", "Right hemisphere"],
        ["deep", "Deep structures"],
      ]
        .map(
          ([id, label]) =>
            `<button class="action" data-cutaway="${id}">${label}</button>`,
        )
        .join("")}`,
  );
}
function bindPanel() {
  const op = $("#operation");
  if (op) {
    op.value = operation;
    op.onchange = () => {
      operation = op.value;
      resetModel();
    };
  }
  const queue = $("#queue-mode");
  if (queue) {
    queue.value = queueMode;
    queue.onchange = () => {
      queueMode = queue.value;
      snap = JSON.parse(model.queue_mode(queueMode));
      setLevel(level);
      showTraffic();
      updateSnapshot();
    };
  }

  const pace = $("#pace");
  if (pace) {
    pace.value = String(speed);
    pace.onchange = () => (speed = +pace.value);
  }
  const mem = $("#memory-layout");
  if (mem) {
    mem.value = memoryLayout;
    mem.onchange = () => {
      memoryLayout = mem.value;
      resetModel();
    };
  }
  const cache = $("#cache-enabled");
  if (cache)
    cache.onchange = () => {
      cacheEnabled = cache.checked;
      resetModel();
    };
  const preset = $("#input-preset");
  if (preset)
    preset.onchange = () => {
      if (preset.value !== "custom") {
        input = pattern(preset.value);
        resetModel();
      }
    };
  const pin = $("#pinned-output");
  if (pin)
    pin.onchange = () => {
      pinnedOutput = +pin.value;
      renderPanel();
    };
  const search = $("#region-search");
  if (search)
    search.oninput = () =>
      $$("[data-region]").forEach(
        (b) =>
          (b.hidden = !b.textContent
            .toLowerCase()
            .includes(search.value.toLowerCase())),
      );
  const tile = $("#input-tile");
  if (tile) {
    const index = (e) => {
      const r = tile.getBoundingClientRect();
      return (
        Math.max(
          0,
          Math.min(7, Math.floor(((e.clientY - r.top) / r.height) * 8)),
        ) *
          8 +
        Math.max(
          0,
          Math.min(7, Math.floor(((e.clientX - r.left) / r.width) * 8)),
        )
      );
    };
    tile.onpointerdown = (e) => {
      if (e.button !== 0) return;
      tile.focus();
      brush = index(e);
      paint = input[brush] ? 0 : 7;
      tile.setPointerCapture(e.pointerId);
      input[brush] = paint;
      resetModel();
    };
    tile.onpointermove = (e) => {
      if (paint == null) return;
      brush = index(e);
      if (input[brush] !== paint) {
        input[brush] = paint;
        resetModel();
      }
    };
    tile.onpointerup = tile.onpointercancel = () => (paint = null);
    tile.onkeydown = (e) => {
      const offset = {
        ArrowLeft: 63,
        ArrowRight: 1,
        ArrowUp: 56,
        ArrowDown: 8,
      }[e.key];
      if (offset || e.key === " ") {
        e.preventDefault();
        if (offset) brush = (brush + offset) % 64;
        else {
          input[brush] = input[brush] ? 0 : 7;
          resetModel();
        }
        drawTiles();
      }
    };
    tile.onfocus = tile.onblur = drawTiles;
  }
  const output = $("#output-tile");
  if (output) {
    output.onclick = (e) => {
      const r = output.getBoundingClientRect();
      showValue(
        Math.min(
          63,
          Math.floor(((e.clientY - r.top) / r.height) * 8) * 8 +
            Math.floor(((e.clientX - r.left) / r.width) * 8),
        ),
      );
    };
    output.onkeydown = (e) => {
      const off = { ArrowLeft: 63, ArrowRight: 1, ArrowUp: 56, ArrowDown: 8 }[
        e.key
      ];
      if (off) {
        e.preventDefault();
        pinnedOutput = (pinnedOutput + off) % 64;
        drawTiles();
      }
      if (e.key === "Enter") showValue(pinnedOutput);
    };
  }
}
function drawTiles() {
  if (family === "switch") return;
  for (const [selector, values, valid] of [
    ["#input-tile", input, null],
    ["#output-tile", snap?.output || [], snap?.valid || []],
  ]) {
    const c = $(selector);
    if (!c) continue;
    const ctx = c.getContext("2d"),
      s = c.width / 8;
    ctx.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < 64; i++) {
      const v = values[i] || 0;
      const shade = Math.min(
        7,
        (Math.abs(v) * 7) / (valid && operation === "mix" ? 28 : 7),
      );
      ctx.fillStyle =
        valid && !valid[i]
          ? "#111c17"
          : v < 0
            ? `rgb(${60 + shade * 12},${70 + shade * 13},${72 + shade * 15})`
            : `rgb(${25 + shade * 29},${37 + shade * 29},${31 + shade * 29})`;
      ctx.fillRect((i % 8) * s + 1, Math.floor(i / 8) * s + 1, s - 2, s - 2);
      if (
        document.activeElement === c &&
        i === (valid ? pinnedOutput : brush)
      ) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          (i % 8) * s + 3,
          Math.floor(i / 8) * s + 3,
          s - 6,
          s - 6,
        );
      }
    }
  }
  if ($("#output-count"))
    $("#output-count").textContent =
      `${snap.counters.completed_outputs} / 64 stored. Click to inspect.`;
}
function pause() {
  playing = false;
  accumulator = 0;
  updateControls();
  if (snap && !reader.hidden && tabs.get(currentTab)?.live) renderPanel();
}
function isComplete() {
  return family === "switch"
    ? snap?.occupied === 0 && snap?.admitted > 0
    : snap?.status === "complete";
}
function updateControls() {
  $("#run").disabled = !model;
  $("#run").textContent =
    level !== "execution"
      ? family === "switch"
        ? "Follow a packet ↗"
        : "Run a matrix ↗"
      : playing
        ? "Pause Ⅱ"
        : isComplete()
          ? "Replay ↗"
          : "Play ↗";
  $("#run").setAttribute("aria-pressed", String(playing));
  $("#step").hidden = $("#reset").hidden = level !== "execution";
  $("#step").disabled = !model || isComplete();
  $("#run-summary").textContent =
    level === "execution" && snap
      ? `tick ${snap.tick} · ${family === "switch" ? snap.delivered + " delivered" : snap.counters.completed_outputs + "/64 stored"}`
      : "";
}

function resetModel() {
  if (!wasm) return;
  pause();
  model?.free();
  if (family === "switch") {
    model = new wasm.FabricSimulation(queueMode);
    for (let i = 0; i < 3; i++) model.inject(i, 6);
  } else
    model = new wasm.SiliconSimulation(
      JSON.stringify({
        mode: family,
        input,
        filter: operation,
        layout: memoryLayout,
        cache_enabled: cacheEnabled,
        issue_width: 2,
      }),
    );
  snap = JSON.parse(model.snapshot());
  phase = 0.5;
  updateSnapshot();
}

function updateSnapshot() {
  updateControls();
  drawTiles();
  dirty = true;
  window.dispatchEvent(
    new CustomEvent("doke-silicon-state", {
      detail: { snapshot: snap, input: [...input], family },
    }),
  );
  if (!playing && tabs.get(currentTab)?.live && !reader.hidden) renderPanel();
}
function advance(count = 1) {
  snap = JSON.parse(model.advance(count));
  if (isComplete()) playing = false;
  updateSnapshot();
  return snap;
}
function finish() {
  pause();
  for (let i = 0; i < 400 && !isComplete(); i++) {
    const occupied = snap.occupied,
      delivered = snap.delivered;
    snap = JSON.parse(model.advance(256));
    if (
      family === "switch" &&
      snap.occupied === occupied &&
      snap.delivered === delivered
    )
      break;
  }
  if (family !== "switch" && !isComplete())
    throw Error("Model exceeded bounded run budget");
  updateSnapshot();
  return structuredClone(snap);
}

function setLevel(next) {
  if (!["processor", "core", "execution"].includes(next)) return;
  if (world === "brain") setWorld(family);
  level = next;
  document.body.dataset.level = level;
  layout = makeLayout(family, level, profile, selectedUnit, queueMode);
  renderer?.chip_scene(JSON.stringify(layout));
  if (renderer) {
    const target = layout.camera;
    renderer.chip_camera(target[0] + (reduced ? 0 : 1.0), ...target.slice(1));
    transition = reduced ? null : { start: performance.now(), to: target };
  }
  $("#chip-labels").innerHTML = layout.blocks
    .filter((b) => b.label || Number.isInteger(b.lane))
    .map(
      (b) =>
        `<span class="chip-label ${Number.isInteger(b.lane) ? "lane-label" : ""}" data-region="${b.region}">${esc(b.title)}</span>`,
    )
    .join("");
  updateHeading();
  updateControls();
  dirty = true;
  closePanel();
}
function updateHeading() {
  const p = profileData(),
    name = familyNames[family];
  const coreTitles = {
    cpu: `Inside core ${selectedUnit + 1}`,
    gpu: `Inside SM ${selectedUnit + 1}`,
    tensor: "Inside the matrix unit",
    switch: "Inside the packet path",
  };
  const executionTitles = {
    cpu: "A value through a CPU",
    gpu: "One warp. 32 lanes.",
    tensor: "A wave of multiply-adds.",
    switch: "One packet. A path through.",
  };
  const summaries = {
    cpu: "16 cores. Two compute groups. Start with one.",
    gpu: `${p.counts.sms} streaming multiprocessors. Start with one.`,
    tensor:
      "65,536 multiply-accumulate units. Explore a representative window.",
    switch: "From ingress to queues, scheduling and egress.",
  };
  $("#eyebrow").textContent =
    world === "brain"
      ? "HUMAN REFERENCE ATLAS"
      : level === "execution"
        ? "FOLLOW THE COMPUTATION"
        : "INSIDE THE " + name;
  $("#scene-title").textContent =
    world === "brain"
      ? "The human brain"
      : level === "processor"
        ? p.name
        : level === "core"
          ? coreTitles[family]
          : executionTitles[family];
  $("#scene-description").textContent =
    world === "brain"
      ? "Reference anatomy. Explore the structures that support seeing and thinking."
      : level === "processor"
        ? summaries[family]
        : architecture.families[family].levels.find((l) => l.id === level)
            .description;
  $("#depth-nav").hidden = world === "brain";
  $$("button[data-level]").forEach((b) => {
    b.toggleAttribute("aria-current", b.dataset.level === level);
    if (b.dataset.level === level) b.setAttribute("aria-current", "step");
    if (b.dataset.level === "core")
      b.textContent = {
        cpu: "Inside a core",
        gpu: "Inside an SM",
        tensor: "Inside the array",
        switch: "Inside the path",
      }[family];
    if (b.dataset.level === "execution")
      b.textContent =
        family === "switch" ? "Follow a packet" : "Follow a value";
  });
  $("#level-enter").hidden = world === "brain" || level === "execution";
  $("#level-enter").innerHTML =
    (level === "processor"
      ? {
          cpu: "Explore one core",
          gpu: "Explore one SM",
          tensor: "Explore the array",
          switch: "Explore the packet path",
        }[family]
      : "Follow the data") + " <span>↘</span>";
  $("#scene-note").textContent =
    world === "brain"
      ? "Human reference atlas · authored pathway guide"
      : level === "execution"
        ? "Executable teaching model · ticks are not vendor cycles"
        : layout?.representative
          ? "Representative functional view · source-linked architecture"
          : "Original functional schematic · source-linked architecture";
  $("#input-toggle").textContent = family === "switch" ? "Traffic" : "Input";
  hdrText?.redraw();
}

async function ensureBrain() {
  if (brain) return brain;
  if (!brainPromise)
    brainPromise = import("./brain-comparison.js")
      .then((m) => m.initBrainComparison(wasm))
      .then((b) => {
        brain = b;
        b.setInput?.(input);
        if (world === "brain" && currentTab === "anatomy") showAnatomy();
        return b;
      })
      .catch((e) => {
        brainPromise = null;
        $("#brain-loading").hidden = false;
        $("#brain-loading").textContent =
          `Atlas unavailable: ${e.message}. Reload to retry.`;
        console.warn(e);
        return null;
      });
  return brainPromise;
}
function syncSurfaces() {
  document.body.classList.toggle(
    "compare-mode",
    comparing && world !== "brain",
  );
  document.body.dataset.world = world;
  document.body.dataset.comparisonView ||= "chip";
  $("#chip-stage").hidden = world === "brain";
  $("#brain-stage").hidden = world !== "brain" && !comparing;
  $("#brain-label").hidden = !comparing || world === "brain";
  $("#brain-guide").hidden = world === "brain" ? !guideVisible : !comparing;
  $("#comparison-mobile").hidden = !comparing || world === "brain";
  $("#compute-controls").hidden = world === "brain";
  $("#brain-controls").hidden = world !== "brain";
  $("#compare-toggle").hidden = world === "brain";
  $("#compare-toggle").setAttribute("aria-pressed", String(comparing));
  $("#hardware").value = world === "brain" ? "" : profile;
  $("#brain-stimulus").hidden = family === "switch";
  $$("button[data-world]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.world === world)),
  );
  resize();
  if ($("#brain-guide").hidden || $("#brain-stage").hidden) brain?.pause();
  brain?.redraw();
}
function setWorld(next) {
  if (next === "brain") {
    pause();
    closePanel();
    $("#settings").hidden = true;
    world = "brain";
    syncSurfaces();
    updateHeading();
    ensureBrain();
    location.hash = "brain";
    dirty = true;
  } else if (defaults[next])
    setHardware(family === next ? profile : defaults[next]);
}
function setHardware(id) {
  const p = architecture?.profiles[id];
  if (!p || !wasm) return;
  pause();
  closePanel();
  $("#settings").hidden = true;
  tabs.clear();
  currentTab = null;
  const same = id === profile && model;
  profile = id;
  family = p.family;
  world = family;
  if (!same) {
    selectedUnit = 0;
    snap = null;
    resetModel();
  }
  syncSurfaces();
  setLevel(same ? level : "processor");
  location.hash = id;
  dirty = true;
}

function rendererState() {
  if (!renderer || !layout || !snap) return;
  if (family === "switch") {
    renderFabric();
    return;
  }
  const activity = new Float32Array(256),
    flows = [];
  for (const n of snap.nodes) {
    const b = resolveBlock(layout, n.id);
    if (b)
      activity[b.region] =
        n.state === "busy"
          ? 0.83
          : n.occupancy
            ? Math.min(0.6, 0.2 + (0.4 * n.occupancy) / Math.max(1, n.capacity))
            : 0.018;
  }
  for (const l of snap.lanes || []) {
    const b = resolveBlock(
      layout,
      (family === "tensor" ? "pe" : "lane") + l.lane,
    );
    if (b && l.active) activity[b.region] = 0.8;
  }
  for (const t of snap.transfers
    .filter((t) => t.start_tick <= snap.tick && t.end_tick > snap.tick)
    .slice(-32)) {
    const a = resolveBlock(layout, t.from),
      b = resolveBlock(layout, t.to);
    if (!a || !b) continue;
    const progress = Math.min(
      1,
      (snap.tick - t.start_tick + (reduced ? 0.5 : phase)) /
        Math.max(1, t.end_tick - t.start_tick),
    );
    flows.push(
      a.position[0],
      a.position[1] + 0.14,
      a.position[2],
      b.position[0],
      b.position[1] + 0.14,
      b.position[2],
      progress,
    );
    activity[a.region] = Math.max(activity[a.region], 0.3);
  }
  renderer.activity(activity);
  renderer.chip_flows(new Float32Array(flows));
}
function labels() {
  if (!renderer) return;
  const r = canvas.getBoundingClientRect(),
    occupied = ["header", ".scene-heading", "#reader", "#dock", "#level-enter"]
      .map((s) => $(s))
      .filter((e) => !e.hidden)
      .map((e) => e.getBoundingClientRect());
  $$(".chip-label").forEach((el) => {
    const b = layout.blocks[+el.dataset.region],
      p = renderer.project(
        b.position[0],
        b.position[1] + b.size[1] / 2 + 0.08,
        b.position[2],
      );
    if (Number.isInteger(b.lane)) {
      const outputIndex = outputForLane(b.lane);
      const output = snap.detail.outputs[outputIndex];
      el.textContent = output?.retired_terms
        ? String(output.accumulated_sum)
        : "·";
      el.classList.toggle("pinned", outputIndex === pinnedOutput);
    }
    el.style.left = `${(p[0] / canvas.width) * r.width}px`;
    el.style.top = `${(p[1] / canvas.height) * r.height}px`;
    el.hidden = false;
    const bounds = el.getBoundingClientRect();
    el.hidden =
      p[2] < 0 ||
      p[2] > 1 ||
      occupied.some(
        (o) =>
          bounds.right > o.left &&
          bounds.left < o.right &&
          bounds.bottom > o.top &&
          bounds.top < o.bottom,
      );
    if (!el.hidden) occupied.push(bounds);
  });
}
function resize() {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const quality = $("#resolution").value,
    dpr = devicePixelRatio || 1;
  let scale =
    quality === "balanced"
      ? Math.min(dpr, 1.5)
      : quality === "ultra"
        ? Math.max(3, dpr * 1.75)
        : Math.max(2, dpr * 1.25);
  scale = Math.min(
    scale,
    4096 / r.width,
    4096 / r.height,
    Math.sqrt(12000000 / (r.width * r.height)),
  );
  canvas.width = Math.max(1, Math.round(r.width * scale));
  canvas.height = Math.max(1, Math.round(r.height * scale));
  renderer?.resize(canvas.width, canvas.height);
  if (renderer)
    $("#render-status").textContent =
      renderer.backend() + " · " + pretty(canvas.width) + " px";
  dirty = true;
  hdrText?.redraw();
}
function updateLight() {
  const mode = $("#light-mode").value,
    active = configureHDR(canvas, renderer, mode === "auto");
  renderer?.hdr_output(active);
  renderer?.glow(mode === "quiet" ? 0.2 : 1.35);
  if (!active && hdrText) {
    hdrText.destroy();
    hdrText = null;
  }
  if (active && !hdrText)
    try {
      hdrText = new HDRText(
        canvas.getContext("webgpu").getConfiguration().device,
      );
    } catch {}
  $("#light-status").textContent = active
    ? "Extended-range HDR is active."
    : "SDR contrast and bloom. Physical brightness range depends on the display.";
  hdrText?.redraw();
  dirty = true;
}
function pick(e) {
  if (!renderer) return;
  const r = canvas.getBoundingClientRect();
  return layout.blocks.find(
    (b) =>
      b.region ===
      renderer.pick(
        (e.clientX - r.left) / r.width,
        (e.clientY - r.top) / r.height,
      ),
  );
}
function bind() {
  $("#hardware").onchange = (e) => setHardware(e.target.value);
  for (const b of $$("button[data-world]"))
    b.onclick = () => setWorld(b.dataset.world);
  for (const b of $$("button[data-level]"))
    b.onclick = () => setLevel(b.dataset.level);
  $("#level-enter").onclick = () =>
    setLevel(level === "processor" ? "core" : "execution");
  $("#compare-toggle").onclick = () => {
    comparing = !comparing;
    syncSurfaces();
    if (comparing) {
      ensureBrain();
    }
  };
  $$("button[data-comparison-view]").forEach(
    (b) =>
      (b.onclick = () => {
        document.body.dataset.comparisonView = b.dataset.comparisonView;
        $$("button[data-comparison-view]").forEach((x) =>
          x.setAttribute("aria-pressed", String(x === b)),
        );
        resize();
        brain?.redraw();
      }),
  );
  $("#run").onclick = () => {
    if (level !== "execution") {
      setLevel("execution");
      if (family === "switch") showTraffic();
      else showValue(pinnedOutput);
    }
    if (playing) pause();
    else {
      if (isComplete()) resetModel();
      playing = true;
      accumulator = 0;
      advance(1);
      updateControls();
    }
  };
  $("#step").onclick = () => {
    pause();
    advance();
  };
  $("#reset").onclick = resetModel;
  $("#input-toggle").onclick = showInput;
  $("#explain").onclick = showOverview;
  $("#reader-close").onclick = closePanel;
  $("#reader-tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) {
      currentTab = b.dataset.tab;
      renderTabs();
      renderPanel();
    }
  };
  $("#inspection").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.source) showSource(b.dataset.source);
    if (b.hasAttribute("data-inject")) {
      snap = JSON.parse(model.inject(Number(b.dataset.inject), 6));
      updateSnapshot();
    }
    if (b.hasAttribute("data-block")) {
      const port = Number(b.dataset.block);
      snap = JSON.parse(model.block(port, !snap.blocked[port]));
      updateSnapshot();
    }

    if (b.dataset.inspect) {
      if (b.dataset.inspectLevel !== level) setLevel(b.dataset.inspectLevel);
      showBlock(layout.blocks.find((x) => x.key === b.dataset.inspect));
    }
    if (b.dataset.enter) {
      selectedUnit = Number(b.dataset.unit ?? selectedUnit);
      setLevel(b.dataset.enter);
    }
    if (b.hasAttribute("data-value")) showValue(b.dataset.value);
    if (b.hasAttribute("data-follow-lane"))
      showValue(outputForLane(Number(b.dataset.followLane)));
    if (b.hasAttribute("data-state")) showState();
    if (b.hasAttribute("data-input")) showInput();
    if (b.dataset.region) brain?.selectRegion(b.dataset.region, false);
    if (b.dataset.focusRegion) {
      brain?.selectRegion(b.dataset.focusRegion, true);
      brain?.getRenderer()?.zoom(0.45);
      brain?.redraw();
      closePanel();
    }
    if (b.dataset.cutaway) {
      brain?.setCutaway(b.dataset.cutaway);
      toast(b.textContent);
      closePanel();
    }
  };
  $("#settings-toggle").onclick = () => {
    const visible = $("#settings").hidden;
    $("#settings").hidden = !visible;
    if (visible) closePanel();
  };
  $("#about").onclick = showAbout;
  $("#light-mode").onchange = updateLight;
  $("#resolution").onchange = resize;
  $("#reduce-motion").checked = reduced;
  $("#reduce-motion").onchange = (e) => {
    reduced = e.target.checked;
    if (reduced) pause();
    dirty = true;
  };
  $("#zoom-in").onclick = () => {
    if (world === "brain") brain?.getRenderer()?.zoom(-0.15);
    else renderer?.zoom(-0.15);
    dirty = true;
    brain?.redraw();
  };
  $("#zoom-out").onclick = () => {
    if (world === "brain") brain?.getRenderer()?.zoom(0.15);
    else renderer?.zoom(0.15);
    dirty = true;
    brain?.redraw();
  };
  $("#reset-camera").onclick = () => {
    if (world === "brain") brain?.resetView();
    else renderer?.chip_camera(...layout.camera);
    transition = null;
    dirty = true;
  };
  $("#anatomy").onclick = showAnatomy;
  $("#brain-cutaway").onclick = showCutaway;
  $("#brain-vision").onclick = () => {
    guideVisible = !guideVisible;
    syncSurfaces();
  };
  $("#brain-evidence").onclick = showBrainEvidence;
  $("#brain-guide-evidence").onclick = showTiming;
  canvas.onpointerdown = (e) => {
    if (e.button !== 0) return;
    transition = null;
    chipPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (chipPointers.size === 2) {
      drag = null;
      pinch = null;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    drag = {
      x: e.clientX,
      y: e.clientY,
      pan: e.shiftKey,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (chipPointers.has(e.pointerId))
      chipPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (chipPointers.size === 2) {
      const [a, b] = [...chipPointers.values()],
        next = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        };
      if (pinch && next.distance > 0 && pinch.distance > 0) {
        renderer?.zoom(Math.log(pinch.distance / next.distance));
        renderer?.pan((next.x - pinch.x) * 0.006, (next.y - pinch.y) * 0.006);
      }
      pinch = next;
      dirty = true;
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      drag.moved ||= Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4;
      if (drag.moved) {
        if (drag.pan) renderer?.pan(dx * 0.006, dy * 0.006);
        else renderer?.orbit(dx * 0.005, dy * 0.005);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      dirty = true;
      $("#hover-label").style.display = "none";
    } else {
      const b = pick(e),
        label = $("#hover-label");
      label.style.display = b ? "block" : "none";
      if (b) {
        label.textContent = b.title;
        label.style.left = Math.min(innerWidth - 180, e.clientX + 15) + "px";
        label.style.top = e.clientY + 16 + "px";
      }
    }
  };
  canvas.onpointerup = (e) => {
    chipPointers.delete(e.pointerId);
    pinch = null;
    if (drag && !drag.moved) showBlock(pick(e));
    drag = null;
  };
  canvas.onpointercancel = (e) => {
    chipPointers.delete(e.pointerId);
    pinch = null;
    drag = null;
  };
  canvas.onpointerleave = () => ($("#hover-label").style.display = "none");
  canvas.ondblclick = (e) => {
    const b = pick(e);
    if (b?.enter) {
      selectedUnit = b.unit ?? selectedUnit;
      setLevel(b.enter);
    }
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    transition = null;
    renderer?.zoom(Math.max(-0.2, Math.min(0.2, e.deltaY * 0.001)));
    dirty = true;
  };
  canvas.onkeydown = (e) => {
    const m = {
      ArrowLeft: [-0.1, 0],
      ArrowRight: [0.1, 0],
      ArrowUp: [0, -0.1],
      ArrowDown: [0, 0.1],
    }[e.key];
    if (m) {
      e.preventDefault();
      renderer?.orbit(...m);
    } else if (e.key === "+" || e.key === "=") renderer?.zoom(-0.15);
    else if (e.key === "-") renderer?.zoom(0.15);
    else if (e.key === "Home") {
      e.preventDefault();
      renderer?.chip_camera(...layout.camera);
    } else if (e.key === "Enter") showOverview();
    transition = null;
    dirty = true;
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePanel();
      $("#settings").hidden = true;
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    last = 0;
  });
  $("#inspection").onscroll = () => hdrText?.redraw();
  new ResizeObserver(resize).observe($("#chip-stage"));
  window.addEventListener("resize", resize);
  window.addEventListener("doke-comparison-evidence", (e) => {
    const d = e.detail;
    if (d.regionId) showRegion(d.regionId, d.region);
    else {
      showTiming();
    }
  });
}
function frame(time) {
  const dt = last ? Math.min(0.08, (time - last) / 1000) : 0;
  last = time;
  if (!document.hidden) {
    if (playing && model) {
      accumulator +=
        dt * { cpu: 80, gpu: 12, tensor: 10, switch: 4 }[family] * speed;
      const n = Math.min(256, Math.floor(accumulator));
      accumulator -= n;
      if (n) advance(n);
      phase = accumulator;
      dirty = true;
    }
    if (transition && renderer) {
      const t = Math.min(1, (time - transition.start) / 380),
        target = transition.to;
      renderer.chip_camera(target[0] + Math.pow(1 - t, 3), ...target.slice(1));
      if (t === 1) transition = null;
      dirty = true;
    }
    if (
      playing &&
      !reader.hidden &&
      tabs.get(currentTab)?.live &&
      time - liveRefresh > 160 &&
      !document.activeElement?.matches(
        "#inspection select, #inspection input, #inspection textarea",
      )
    ) {
      renderPanel();
      liveRefresh = time;
    }
    if (dirty && renderer && world !== "brain")
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
    dirty = false;
  }
  requestAnimationFrame(frame);
}
async function boot() {
  try {
    [architecture, brainContent, comparison, timescales] = await Promise.all(
      [
        "architecture.json",
        "brain.json",
        "comparison.json",
        "timescales.json",
      ].map(async (path) => {
        const r = await fetch(path);
        if (!r.ok) throw Error(path + " unavailable");
        return r.json();
      }),
    );
    for (const [prefix, data] of [
      ["chip", architecture],
      ["brain", brainContent],
      ["comparison", comparison],
      ["timescales", timescales],
    ])
      for (const [id, s] of Object.entries(data.sources))
        sources.set(prefix + ":" + id, s);
    wasm = await import("./pkg/doke.js");
    await wasm.default();
    resize();
    const forceGL =
      !navigator.gpu ||
      new URLSearchParams(location.search).get("backend") === "webgl";
    try {
      renderer = await wasm.BrainRenderer.create(canvas, forceGL, hdrCapable());
    } catch (e) {
      if (forceGL) throw e;
      const replacement = canvas.cloneNode();
      canvas.replaceWith(replacement);
      canvas = replacement;
      resize();
      renderer = await wasm.BrainRenderer.create(canvas, true, false);
    }
    resize();
    updateLight();
    $("#loading").hidden = true;
    $("#render-status").textContent =
      renderer.backend() + " · " + pretty(canvas.width) + " px";
  } catch (e) {
    $("#loading").textContent =
      "3D unavailable. " + (e.message || e) + ". Reload to retry.";
    console.warn(e);
  }
  if (wasm && architecture) {
    bind();
    resetModel();
    const route = location.hash.slice(1);
    if (architecture.profiles[route]) setHardware(route);
    else
      setWorld(
        [...Object.keys(defaults), "brain"].includes(route) ? route : "gpu",
      );
    if (comparing) ensureBrain();
  }
  document.documentElement.dataset.ready = "true";
  requestAnimationFrame(frame);
}
window.dokeFocused = {
  snapshot: () => (snap ? structuredClone(snap) : null),
  getState: () => ({
    world,
    family,
    level,
    profile,
    playing,
    rendererReady: !!renderer,
    selectedUnit,
    pinnedOutput,
    comparing,
    operation,
  }),
  input: () => [...input],
  finish,
  reset: resetModel,
  setWorld,
  setHardware,
  setLevel,
  advance: () => {
    pause();
    return advance();
  },
  getRenderer: () => renderer,
  getWasm: () => wasm,
  inspectBlock: (key) => showBlock(layout?.blocks.find((b) => b.key === key)),
  pin: showValue,
  layout: () => structuredClone(layout),
};
window.dokeSilicon = window.dokeFocused;
boot();
