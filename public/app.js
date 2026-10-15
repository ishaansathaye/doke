import { PathwayExperiment } from "./experiment.js";
import { hdrCapable, configureHDR, HDRText, loadNative } from "./display.js";
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
const state = {
  tab: "explore",
  view: "whole",
  region: null,
  activity: null,
  chemical: null,
  time: 0,
  playing: false,
  chapter: -1,
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  paths: true,
  mode: "atlas",
  step: 0,
  circuitPlaying: false,
  drive: 2.5,
  inhibition: 8,
  quality: "auto",
  camera: 0,
  parent: null,
  microPlaying: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  microClock: 0,
  microElapsed: 0,
  graph: false,
  pulse: 0,
  light: "auto",
  neurons: false,
  neuronAnchor: null,
  color: true,
};
let experiment;
let atlas,
  content,
  renderer,
  wasm,
  circuit,
  dirty = true,
  last = 0,
  lastUI = 0,
  clock = 0,
  trace = [],
  gpuError = "",
  resizeView = () => {},
  loadToken = 0;
const canvas = () => $("#brain-canvas"),
  overlay = $("#overlay-canvas"),
  ctx = overlay.getContext("2d");
let atlasBytes = null,
  sceneLoaded = "atlas",
  hdrText = null,
  hdrActive = false,
  detailAbort = null,
  moleculeData = null,
  sceneSerial = 0,
  textDirty = true,
  interactionTime = 0;
const moleculeCache = new Map();
const initialDetails = $("#details").innerHTML;
const regions = () => atlas.regions.filter((r) => r.kind !== 2);
const regionBy = (id) => atlas.regions.find((r) => r.id === id);
const fmt = (n) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
function toast(s) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
}
function evidence(keys) {
  return `<div class="evidence"><div class="eyebrow">FOLLOW THE EVIDENCE</div>${[...new Set(keys)].map((k) => `<button class="source-link" data-source="${esc(k)}"><span>${esc(content.sources[k].authors)} · ${content.sources[k].year}</span><span>↗</span></button>`).join("")}</div>`;
}
function showSource(id) {
  const s = content.sources[id];
  if (!s) return;
  writeDetails(
    `source-${id}`,
    `${s.authors} · ${s.year}`,
    `<div class="eyebrow">SOURCE RECORD · ${s.year}</div><h2>${esc(s.title)}</h2><p>${esc(s.authors)}</p><div class="pill">${esc(s.method)} · ${esc(s.species)}</div><h3>What it supports</h3><p>${esc(s.finding)}</p><h3>What it does not establish</h3><p>${esc(s.limit)}</p><a class="primary external" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Read the source ↗</a><p class="small-note">Evidence is linked to specific explanations. Use the findings and limitations together when interpreting an explanation.</p>`,
    { reference: true, reveal: true },
  );
}
function about() {
  writeDetails(
    "about",
    "About",
    `<div class="eyebrow">ABOUT DOKE</div><h2>A window into the brain.<br><em>With the evidence in view.</em></h2><p>Explore reference anatomy, follow everyday activities, and discover how cells and chemical messengers work together.</p><h3>Anatomy, activity and signaling</h3><p><b>Anatomy:</b> the Allen Human Reference Atlas 2020 provides a shared reference for the brain’s structures. The displayed regions group atlas labels; their boundaries are simplified teaching surfaces, not a scan of an individual.</p><p><b>Activities and synapses:</b> research findings guide the explanations of music, reward, vision, movement and chemical signaling. Glowing regions and traveling particles illustrate those explanations; they do not measure firing rates or chemical concentrations.</p><p><b>Neural circuit:</b> an excitatory–inhibitory population model inspired by Wilson–Cowan explores how interacting populations influence one another. Its parameters are educational, not fitted to a person’s brain.</p><p><b>Timing experiment:</b> a controlled spike-pair protocol explores one model of synaptic plasticity. Pairing prescribes both spike times; a separate cue-only probe calculates the receiving cell’s response. The model captures selected timing effects, not a universal account of biological learning.</p><h3>Follow a chemical messenger</h3><p>Synthesis, release, receptor action and clearance are distinct processes. A messenger’s effect depends on the receiving cell and receptor. Molecular structures come from PubChem; they represent individual conformers rather than the molecules’ motion inside a living synapse.</p><h3>Reference anatomy</h3><p>Allen Human Reference Atlas – 3D, 2020. Allen Institute for Brain Science; Ding et al. RRID:SCR_017764. <a href="${esc(atlas.source)}" target="_blank" rel="noopener noreferrer">Original atlas</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. Adapted through teaching-region grouping, resampling, smoothing and surface simplification.</p>${evidence(["allen", "wilson", "bold", "neurotransmitters", "stdp-bi-poo", "stdp-model"])}`,
    { reference: true, reveal: true },
  );
}
function renderLeft() {
  if (state.tab === "explore") {
    $("#left-content").innerHTML =
      `<label class="search"><span>⌕</span><input id="region-search" placeholder="Find a brain region" aria-label="Find a brain region"><kbd>/</kbd></label><div class="list-title"><span>ANATOMY</span><span id="region-count">${regions().length} REGIONS</span></div><div id="region-list" class="region-list"></div>`;
    renderRegions("");
    $("#region-search").oninput = (e) => renderRegions(e.target.value);
  } else if (state.tab === "activities") {
    $("#left-content").innerHTML =
      `<div class="list-title"><span>EVERYDAY EXPERIENCE</span><span>04 STORIES</span></div><div class="card-list">${content.activities.map((a) => `<button class="activity-card ${state.activity?.id === a.id ? "selected" : ""}" data-activity="${a.id}"><span class="eyebrow">${a.number} / ${esc(a.tag)}</span><strong>${esc(a.short)}</strong><span class="card-bottom">${a.duration} SEC · ${esc(a.kind)} <b>↗</b></span></button>`).join("")}<p class="small-note">Study findings become a guided story. The animation’s timing and intensity are illustrative.</p></div>`;
  } else if (state.tab === "chemicals") {
    $("#left-content").innerHTML =
      `<div class="list-title"><span>CHEMICAL MESSENGERS</span><span>03 SIGNALS</span></div><div class="card-list">${content.chemicals.map((c) => `<button class="chemical-card ${state.chemical?.id === c.id ? "selected" : ""}" data-chemical="${c.id}"><span class="chemical-symbol">${c.symbol}</span><span><strong>${c.name}</strong><small>${esc(c.className)}</small></span><b>↗</b></button>`).join("")}<div class="note"><div class="eyebrow">FOLLOW A MOLECULE</div><h3>Across the<br>synaptic cleft.</h3><p>Step from synthesis to release, receptor action and clearance.</p><button class="primary" data-synapse>Enter the synapse ↗</button></div><p class="small-note">A chemical can have different effects across cells, receptors and circuits. There is no one-chemical explanation for a feeling.</p></div>`;
  } else {
    $("#left-content").innerHTML =
      `<div class="list-title"><span>EXCITATION & INHIBITION</span><span>TOY MODEL</span></div><div class="card-list"><p>Two interacting populations. Change their inputs and watch the system evolve.</p><label class="lab-control">External drive <output id="drive-output">${state.drive.toFixed(1)}</output><input id="drive" aria-label="External drive" type="range" min="0" max="5" step="0.1" value="${state.drive}"></label><label class="lab-control">Inhibitory coupling <output id="inhibition-output">${state.inhibition.toFixed(1)}</output><input id="inhibition" aria-label="Inhibitory coupling" type="range" min="3" max="15" step="0.1" value="${state.inhibition}"></label><button id="circuit-play" class="primary" ${circuit ? "" : "disabled"}>${state.circuitPlaying ? "Pause model" : "Run model"} <span>↗</span></button><button id="circuit-reset" class="secondary">Reset initial state ↺</button><p class="small-note">${circuit ? "Integrated in Rust at a fixed 1 ms step." : "The Rust model is unavailable on this device."} Parameters are pedagogical, not fitted to human recordings.</p></div>`;
    $("#drive").oninput = (e) => {
      state.drive = +e.target.value;
      $("#drive-output").value = state.drive.toFixed(1);
      dirty = true;
    };
    $("#inhibition").oninput = (e) => {
      state.inhibition = +e.target.value;
      $("#inhibition-output").value = state.inhibition.toFixed(1);
      dirty = true;
    };
    $("#circuit-play").onclick = () => {
      state.circuitPlaying = !state.circuitPlaying;
      renderLeft();
      refreshMicro();
      dirty = true;
    };
    $("#circuit-reset").onclick = () => {
      circuit?.reset();
      trace = [];
      clock = 0;
      state.pulse = 0;
      state.microClock = 0;
      if ($("#model-readout"))
        $("#model-readout").textContent =
          "Model time 0.000 s · E 0.100 · I 0.100";
      dirty = true;
      toast("Model reset to E = I = 0.1");
    };
  }
}
function renderRegions(q) {
  const found = regions().filter((r) =>
    `${r.id} ${r.name} ${r.role} ${r.atlasNames.join(" ")}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  $("#region-count").textContent = `${found.length} REGIONS`;
  $("#region-list").innerHTML = found.length
    ? found
        .map(
          (r) =>
            `<button class="${state.region === r.id ? "selected" : ""}" data-region="${r.id}" aria-pressed="${state.region === r.id}"><span>${esc(r.name)}</span><span>↗</span></button>`,
        )
        .join("")
    : '<p class="empty">No matching region. Try “motor” or “thalamus”.</p>';
}
function setTab(tab) {
  if (!["explore", "activities", "chemicals", "circuit"].includes(tab)) return;
  state.tab = tab;
  $("#drawer-title").textContent = {
    explore: "Anatomy",
    activities: "Everyday experiences",
    chemicals: "Chemical messengers",
    circuit: "Tune the conversation",
  }[tab];
  state.mode = tab === "circuit" ? "circuit" : "atlas";
  state.playing = false;
  state.circuitPlaying = false;
  setMode();
  $$("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false");
  });
  renderLeft();
  if (tab === "explore") {
    state.activity = null;
    state.chemical = null;
    state.region = null;
    renderer?.select(-1);
    writeDetails("overview", "Brain", initialDetails, { activate: false });
  }
  if (tab === "activities" && !state.activity) {
    writeDetails(
      "activities",
      "Activities",
      `<div class="eyebrow">A BRAIN IN CONTEXT</div><h2>One experience.<br><em>Many contributors.</em></h2><p>Choose a study-led story. Pause at any point, select a region, and open the supporting evidence.</p><div class="note"><h3>Start with music.</h3><p>A study of intensely pleasurable music offers a window into anticipation and reward.</p><button class="primary" data-activity="music">Follow the story ↗</button></div><p class="small-note">These lessons highlight selected findings. Unlit areas are not inactive, and the story is not an exhaustive map of an activity.</p>`,
      { activate: false },
    );
  }
  if (tab === "activities" && state.activity) showChapter(true);
  if (tab === "chemicals") selectChemical(state.chemical?.id || "dopamine");
  if (tab === "circuit") {
    writeDetails(
      "circuit",
      "Neural circuit",
      `<div class="eyebrow">A NUMERICAL EXPERIMENT</div><h2>A balance<br><em>in motion.</em></h2><p>Each group represents a normalized population state. Excitation drives activity; inhibition feeds back onto the excitatory population.</p><div class="legend"><span>— Excitatory (E)</span><span>┄ Inhibitory (I)</span></div><output id="model-readout" class="model-readout" tabindex="0" aria-live="off">Model time 0.000 s · E 0.100 · I 0.100</output><p>Try raising external drive, then increase inhibitory coupling. The resulting equilibrium depends on both interactions.</p><div class="note"><div class="eyebrow">WHAT THIS MODEL MEANS</div><p>These are dimensionless population variables—not individual spikes or chemical concentrations. They are not mapped to the atlas.</p></div><button class="secondary" id="equations">Read the equations ↗</button>${evidence(["wilson"])}`,
      { activate: false },
    );
  }
  updateActivity();
  updateTimeline();
  dirty = true;
}
const panelPages = new Map();
let activePanelPage = null,
  latestDetailPage = null,
  nextPanelId = 0;
function rememberPanelScroll() {
  const page = panelPages.get(activePanelPage);
  if (page) {
    page.scroll = $("#details").scrollTop;
    if (page.key === `activity-${state.activity?.id}`)
      page.activityTime = state.time;
  }
}
function renderPanelTabs() {
  const list = $("#panel-tabs");
  for (const page of panelPages.values()) {
    if (!page.opened) continue;
    if (!page.button) {
      const button = document.createElement("button");
      button.id = `document-tab-${nextPanelId++}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "details");
      button.dataset.panelPage = page.key;
      button.onclick = () => revisitPanelPage(page.key);
      page.button = button;
      list.append(button);
    }
    page.button.textContent = page.title;
    page.button.title = page.title;
    const selected =
      document.body.dataset.info === "open" && activePanelPage === page.key;
    page.button.setAttribute("aria-selected", String(selected));
    page.button.tabIndex = selected ? 0 : -1;
  }
  const browse = document.body.dataset.explorer === "open";
  $("#panel-browse").setAttribute("aria-selected", String(browse));
  $("#panel-browse").tabIndex = browse ? 0 : -1;
  $("#close-tab").hidden = browse || !activePanelPage;
  $("#close-tab").title =
    `Close ${panelPages.get(activePanelPage)?.title || "current"} tab`;
}
function revisitPanelPage(key) {
  const page = panelPages.get(key);
  if (!page) return;
  if (key === "experiment" && state.mode !== "experiment") openExperiment();
  if (key === "circuit" && state.mode !== "circuit") setTab("circuit");
  if (
    key.startsWith("molecule-") &&
    (state.mode !== "molecule" || state.chemical?.id !== key.slice(9))
  )
    openMolecule(key.slice(9));
  if (
    key.startsWith("region-") &&
    (state.region !== key.slice(7) || state.mode !== "atlas")
  )
    selectRegion(key.slice(7));
  else if (
    key.startsWith("activity-") &&
    (state.activity?.id !== key.slice(9) || state.mode !== "atlas")
  )
    selectActivity(key.slice(9), page.activityTime || 0);
  else if (
    key.startsWith("chemical-") &&
    (state.chemical?.id !== key.slice(9) || state.mode !== "synapse")
  )
    selectChemical(key.slice(9));
  else if (
    key.startsWith("synapse-") &&
    (state.chemical?.id !== key.slice(8) || state.mode !== "synapse")
  ) {
    state.chemical = content.chemicals.find((c) => c.id === key.slice(8));
    openSynapse();
  }
  selectPanelPage(key, true);
}
function selectPanelPage(key, reveal = false) {
  const page = panelPages.get(key);
  if (!page) return;
  if (activePanelPage !== key) {
    if (reveal) page.returnTo = activePanelPage;
    rememberPanelScroll();
    activePanelPage = key;
    $("#details").replaceChildren(...page.nodes);
    $("#details").scrollTop = page.scroll;
  }
  if (reveal || document.body.dataset.info === "open") page.opened = true;
  if (reveal) {
    document.body.dataset.info = "open";
    document.body.dataset.explorer = "closed";
    if (innerWidth < 821) $("#view-settings").hidden = true;
  }
  if (key === "circuit") {
    const value = trace.at(-1) || [0, 0.1, 0.1];
    const readout = $("#model-readout");
    if (readout)
      readout.textContent = `Model time ${value[0].toFixed(3)} s · E ${value[1].toFixed(3)} · I ${value[2].toFixed(3)}`;
  }
  syncPanel();
  if (!page.button || !page.opened) return;
  $("#details").setAttribute("aria-labelledby", page.button.id);
  page.button.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function writeDetails(
  key,
  title,
  html,
  { activate = true, reference = false, reveal = false } = {},
) {
  let page = panelPages.get(key);
  if (!page) {
    page = { key, title, nodes: [], scroll: 0, reference };
    panelPages.set(key, page);
  }
  // Reopening a reference keeps its reading position and does not duplicate the tab.
  if (!reference || !page.nodes.length) {
    const template = document.createElement("template");
    template.innerHTML = html;
    page.nodes = [...template.content.childNodes];
    if (activePanelPage === key) {
      rememberPanelScroll();
      $("#details").replaceChildren(...page.nodes);
      $("#details").scrollTop = page.scroll;
    }
  }
  if (!reference) latestDetailPage = key;
  if (activate || reveal || !activePanelPage) selectPanelPage(key, reveal);
  else syncPanel();
}
function closePanelTab() {
  const keys = [...panelPages.values()]
      .filter((p) => p.opened)
      .map((p) => p.key),
    index = keys.indexOf(activePanelPage);
  const page = panelPages.get(activePanelPage);
  if (!page) return;
  page.button.remove();
  panelPages.delete(activePanelPage);
  if (latestDetailPage === activePanelPage)
    latestDetailPage = [...panelPages.values()]
      .reverse()
      .find((p) => !p.reference)?.key;
  activePanelPage = null;
  const next = panelPages.get(page.returnTo)?.opened
    ? page.returnTo
    : keys[index - 1] || keys[index + 1];
  if (next) selectPanelPage(next, true);
  else {
    $("#details").replaceChildren();
    openExplorer();
  }
  $("#panel-tabs [aria-selected=true]")?.focus();
}
function syncPanel() {
  $("#panel-browse").hidden = state.mode === "experiment";
  const browse = document.body.dataset.explorer === "open",
    details = document.body.dataset.info === "open";
  $("#info-panel").hidden = !browse && !details;
  $("#panel-browse").textContent =
    state.mode === "experiment"
      ? "Preparation"
      : state.mode === "circuit"
        ? "Controls"
        : state.mode !== "atlas"
          ? "Messengers"
          : state.tab === "activities"
            ? "Activities"
            : "Anatomy";
  $("#browse-page").hidden = !browse;
  $("#details").hidden = !details;
  renderPanelTabs();
  textDirty = true;
  dirty = true;
}
function openExplorer(on = true) {
  document.body.dataset.explorer = on ? "open" : "closed";
  if (on) {
    document.body.dataset.info = "closed";
    if (innerWidth < 821) $("#view-settings").hidden = true;
  }
  syncPanel();
}
function openInfo(on = true) {
  if (on && latestDetailPage) selectPanelPage(latestDetailPage, true);
  document.body.dataset.info = on ? "open" : "closed";
  if (on) {
    document.body.dataset.explorer = "closed";
    if (innerWidth < 821) $("#view-settings").hidden = true;
  }
  syncPanel();
}
function setMode() {
  sceneSerial++;
  if (state.mode === "experiment") experiment?.enter();
  else experiment?.leave();
  const anatomy = state.mode === "atlas";
  document.body.dataset.scene = state.mode;
  canvas().style.visibility = "visible";
  $(".stage-tools").hidden = false;
  $(".scene-hint").hidden = !anatomy;
  $(".segmented").hidden = !anatomy;
  $("#view-settings").hidden = true;
  $("#cut-control").hidden = !(anatomy && state.view === "cut");
  $(".explorer-dock").hidden = !anatomy;
  $$(".atlas-setting").forEach((el) => (el.hidden = !anatomy));
  canvas().setAttribute(
    "aria-label",
    `${anatomy ? "Brain atlas" : state.mode === "molecule" ? "Chemical messenger structure" : state.mode === "synapse" ? "Chemical synapse" : state.mode === "experiment" ? "Four schematic neurons in a timing experiment" : "Neural circuit"}. Drag to orbit, scroll to zoom; arrow keys rotate, plus and minus zoom.`,
  );
  $(".scale-portal").hidden = !anatomy;
  $("#micro-controls").hidden = anatomy || state.mode === "experiment";
  $(".micro-caption").hidden = anatomy || state.mode === "experiment";
  $("#scene-breadcrumb").hidden = anatomy || state.mode === "experiment";
  $("#scene-mode").textContent =
    state.mode === "experiment"
      ? "TIMING → CONNECTION → RESPONSE"
      : state.mode === "circuit"
        ? "A NETWORK OF SIGNALS · TEACHING MODEL"
        : state.mode === "synapse"
          ? "ACROSS THE SYNAPTIC CLEFT"
          : state.mode === "molecule"
            ? "MEET THE MESSENGER · PUBCHEM CONFORMER"
            : state.activity && state.tab === "activities"
              ? "NARRATIVE FLOW · NOT MEASURED AXONS"
              : "THE HUMAN BRAIN";
  $("#scale-tag").textContent = anatomy
    ? viewName()
    : state.mode === "experiment"
      ? "Schematic preparation · not a brain reconstruction"
      : state.mode === "molecule"
        ? "Structure, not dynamics"
        : "Illustrative · not to scale";
  $("#scene-labels").innerHTML = "";
  delete $("#scene-labels").dataset.signature;
  $("#focus-cleft").dataset.focused = "false";
  $("#focus-cleft").textContent = "Focus cleft ⊕";
  $("#scene-loading").hidden = !!renderer || (!anatomy && !!wasm);
  $$("[data-scene]").forEach((b) =>
    b.classList.toggle("active", b.dataset.scene === state.mode),
  );
  $("#quality").disabled = !anatomy;
  syncScene().catch((e) => {
    toast(e.message);
  });
  refreshMicro();
  syncPanel();
  updateTimeline();
  dirty = true;
}
async function syncScene() {
  if (!renderer) return;
  const key =
    state.mode +
    (["molecule", "synapse"].includes(state.mode) ? state.chemical?.id : "");
  if (key === sceneLoaded) {
    if (state.mode === "molecule" && moleculeData) showMoleculeDetails();
    return;
  }
  const ticket = ++sceneSerial;
  detailAbort?.abort();
  if (state.mode === "atlas") {
    if (atlasBytes) renderer.load_mesh(atlasBytes);
    renderer.anatomy();
    applyCamera(state.camera);
    setView(state.view);
    updateActivity();
    if (state.neurons && state.neuronAnchor)
      renderer.neuron_detail(...state.neuronAnchor, true);
  } else if (state.mode === "synapse") {
    renderer.scene(
      1,
      content.chemicals.findIndex((c) => c.id === state.chemical?.id),
    );
    renderer.micro_state(state.step, 0, 0);
  } else if (state.mode === "experiment") {
    renderer.experiment_scene();
    experiment?.tick(0, renderer);
  } else if (state.mode === "circuit") {
    renderer.scene(2, 0);
    renderer.micro_state(0, 0.1, 0.1);
  } else {
    const chem = state.chemical || content.chemicals[0];
    const data =
      moleculeCache.get(chem.id) ||
      (await fetch(`assets/molecules/${chem.id}.json`).then((r) => {
        if (!r.ok) throw Error("Molecular structure unavailable");
        return r.json();
      }));
    moleculeCache.set(chem.id, data);
    if (ticket !== sceneSerial) return;
    moleculeData = data;
    renderer.molecule(JSON.stringify(data));
    renderer.micro_state(0, 0, 0);
    showMoleculeDetails();
  }
  sceneLoaded = key;
  $("#render-stats").textContent =
    `${renderer.backend()} · Rust · ${renderer.triangle_count().toLocaleString()} triangles`;
  canvas().classList.remove("scene-transition");
  void canvas().offsetWidth;
  canvas().classList.add("scene-transition");
  dirty = true;
}
function refreshMicro() {
  if (state.mode === "atlas" || state.mode === "experiment") return;
  const syn = state.mode === "synapse",
    mol = state.mode === "molecule";
  const stepsHTML = syn
    ? ["Synthesis", "Release", "Receptors", "Clearance"]
        .map(
          (name, i) =>
            `<button data-step="${i}" class="${state.step === i ? "active" : ""}"><span>0${i + 1}</span>${name}</button>`,
        )
        .join("")
    : mol
      ? content.chemicals
          .map(
            (c) =>
              `<button data-molecule="${c.id}" class="${state.chemical?.id === c.id ? "active" : ""}">${c.symbol}</button>`,
          )
          .join("")
      : '<button id="stimulate-circuit">Send a signal ↗</button><button id="circuit-controls">Tune the network</button><button id="circuit-source">Model & evidence ⓘ</button>';
  if ($("#micro-steps").dataset.content !== stepsHTML) {
    $("#micro-steps").dataset.content = stepsHTML;
    $("#micro-steps").innerHTML = stepsHTML;
  }
  $("#inspect-molecule").hidden = !syn;
  $("#focus-cleft").hidden = !syn;
  $("#micro-play").hidden = mol;
  $("#micro-play").textContent = (
    syn ? state.microPlaying : state.circuitPlaying
  )
    ? "Ⅱ"
    : "▶";
  $("#micro-play").setAttribute(
    "aria-pressed",
    String(syn ? state.microPlaying : state.circuitPlaying),
  );
  $("#micro-play").setAttribute(
    "aria-label",
    (syn ? state.microPlaying : state.circuitPlaying)
      ? "Pause animation"
      : "Play animation",
  );
  $("#micro-kicker").textContent = syn
    ? `${state.chemical?.name || "Dopamine"} · STEP ${state.step + 1} OF 4`
    : mol
      ? "ATOM BY ATOM"
      : "EXCITATION ↔ INHIBITION";
  $("#micro-title").textContent = syn
    ? [
        "Make the messenger.",
        "Cross the cleft.",
        "Receive the signal.",
        "Clear and recycle.",
      ][state.step]
    : mol
      ? state.chemical.id === "glutamate"
        ? "L-glutamic acid"
        : state.chemical.name
      : "How neurons talk.";
  $("#micro-description").textContent = syn
    ? [
        "Vesicles package chemical messengers. The windowed vesicles bring their contents into sight.",
        "Calcium entry helps trigger release. Follow messenger symbols toward the receiving membrane.",
        state.chemical?.id === "dopamine"
          ? "Binding activates intracellular signaling. Dopamine receptors are not ion-channel pores."
          : "Receptor binding changes the receiving cell’s signaling. Receptor family and ionic gradients matter.",
        "Transport and metabolism regulate the signal. Trails illustrate clearance without assigning a rate.",
      ][state.step]
    : mol
      ? state.chemical.id === "glutamate"
        ? "Glutamate’s conjugate acid, from PubChem. This structure is not a physiological protonation model."
        : "Rotate a real molecular conformer. Atom letters identify each element; restrained color distinguishes oxygen and nitrogen."
      : "Two groups influence each other. The Rust model changes their activity; traveling pulses illustrate signaling, rather than computed individual spikes.";
  const crumb = $("#scene-breadcrumb button:nth-of-type(2)");
  crumb.textContent = state.mode === "circuit" ? "Neural circuit" : "Synapse";
  crumb.dataset.scene = state.mode === "circuit" ? "circuit" : "synapse";
  $("#molecule-crumb").textContent = mol ? ` / ${state.chemical.name}` : "";
}
async function openMolecule(id) {
  if (!state.chemical) state.chemical = content.chemicals[0];
  if (id)
    state.chemical =
      content.chemicals.find((c) => c.id === id) || state.chemical;
  state.mode = "molecule";
  state.tab = "chemicals";
  renderLeft();
  state.microPlaying = false;
  state.circuitPlaying = false;
  setMode();
  openExplorer(false);
  openInfo(false);
}
function showMoleculeDetails() {
  if (moleculeData)
    writeDetails(
      `molecule-${state.chemical.id}`,
      state.chemical.name,
      `<div class="eyebrow">PUBCHEM · CID ${moleculeData.cid}</div><h2>${esc(state.chemical.name)}</h2><p>${esc(moleculeData.note)}</p><div class="atom-key"><span>C · H</span><span class="nitrogen">N</span><span class="oxygen">O</span></div><p>C: carbon · H: hydrogen · N: nitrogen · O: oxygen. Ball sizes and bonds are simplified for legibility; no motion or energy is calculated.</p><a class="primary" href="${moleculeData.source}" target="_blank" rel="noopener">Inspect source structure ↗</a><button class="secondary" data-scene="synapse">Back to the synapse →</button>`,
      { activate: false },
    );
}
function openExperiment() {
  state.mode = "experiment";
  state.playing = false;
  state.circuitPlaying = false;
  state.microPlaying = false;
  setMode();
  openExplorer(false);
  openInfo(false);
}
function experimentInfo() {
  writeDetails(
    "experiment",
    "Timing experiment",
    `<div class="eyebrow">A CONTROLLED PREPARATION</div><h2>Same cue.<br><em>A different response.</em></h2><p>Three cue cells connect to a receiving cell. During pairing, both spike times are imposed. During a probe, the cue acts alone and learning is switched off.</p><h3>Try one change at a time</h3><p>Probe A to record a comparison. Pair it eight times with its signal arriving 10 ms before the target spikes. Probe A again, then test B or C as untouched controls. Reverse the pairing order to explore the opposite effect.</p><h3>What actually changes</h3><p>A bounded spike-timing rule updates connection efficacy. Input arriving before a target spike strengthens a connection in this model; reversing the order weakens it. Timing dependence varies across biological preparations, so this is one teaching rule, not a universal law.</p><p>The receiving cell follows a simplified leaky integrate-and-fire model during probes. Its voltage and threshold are educational parameters, not a recording from a person. Probe peaks are computed voltages; cue response comparisons reuse the same test input.</p><h3>Reading the scene</h3><p>Contact size represents model efficacy, not new anatomical growth. Paths and four cells are schematic. Traveling events follow the simulated axonal delay; glow and enlarged geometry make them visible. Playback runs at one tenth of model speed. Molecules, receptor chemistry and structural growth are not simulated here.</p><h3>A fair comparison</h3><p>Each test starts with transient voltage and timing traces reset while learned weights are retained. The first probe of each cue is the comparison marker; Reset clears it along with all weight changes. A cue you have not paired is an untouched control. Cancel removes future events but keeps changes already made.</p><p class="small-note">This is an experiment with a model, not a test of your memory, intelligence or brain health. State stays in this page and is lost on reload.</p>${evidence(["stdp-bi-poo", "stdp-model", "lif-model", "stdp-limits"])}`,
    { reference: true, reveal: true },
  );
}
function drawHotspots() {
  if (!renderer) return;
  const compactExperiment =
    state.mode === "experiment" && innerWidth >= 600 && innerHeight <= 560;
  let marks = [];
  if (
    state.mode === "atlas" &&
    !state.region &&
    !state.activity &&
    state.tab !== "chemicals"
  )
    marks = [
      {
        p: regionBy("motor").leftCentroid,
        label: "Cerebral cortex",
        region: "motor",
      },
      {
        p: regionBy("cerebellum").leftCentroid,
        label: "Cerebellum",
        region: "cerebellum",
      },
      { p: regionBy("pons").centroid, label: "Brainstem", region: "pons" },
    ];
  if (state.mode === "atlas" && state.neurons && state.neuronAnchor)
    marks = [
      {
        p: state.neuronAnchor.map((v, axis) => v - (axis === 1 ? 0.29 : 0)),
        label: "Neural tissue · enlarged",
        neuron: true,
      },
    ];
  if (state.mode === "synapse")
    marks = [
      { p: [-0.62, 0.97, 0.63], label: "Vesicles", step: 0 },
      { p: [0.55, 0.02, 0.35], label: "Messenger flow", step: 1 },
      { p: [0.6, -0.38, 0.15], label: "Receptors", step: 2 },
    ];
  if (state.mode === "circuit")
    marks = [
      { p: [-0.8, 0.85, 0], label: "Excitatory cells · E", info: true },
      { p: [0.8, 0.85, 0], label: "Inhibitory cells · I", info: true },
    ];
  if (state.mode === "experiment" && renderer.experiment_anchor)
    marks = [0, 1, 2, 3].map((id) => ({
      p: Array.from(renderer.experiment_anchor(id)),
      label: id === 3 ? "Receiving cell" : `Cue ${["A", "B", "C"][id]}`,
      experimentCell: id,
    }));
  if (state.mode === "molecule" && moleculeData?.id === state.chemical?.id)
    marks = moleculeData.atoms
      .map((a, i) => ({
        p: [a.x * 0.3, a.y * 0.3, a.z * 0.3],
        label: a.element,
        element: a.element,
        atom: i,
      }))
      .filter((a) => a.label !== "H");
  if (state.mode === "atlas" && state.view === "deep")
    marks = marks.filter((m) => m.region !== "motor");
  const d = canvas().width / canvas().clientWidth;
  const html = marks
    .map((m) => {
      const p = renderer.project(...m.p);
      if (p[2] < 0 || p[2] > 1) return "";
      const x = p[0] / d,
        y =
          p[1] / d +
          (m.experimentCell !== undefined
            ? compactExperiment
              ? 23
              : innerWidth < 821
                ? 27
                : 44
            : 0);
      if (
        x < 20 ||
        x > innerWidth - 20 ||
        y < 120 ||
        y >
          innerHeight -
            (compactExperiment ? 50 : state.mode === "experiment" ? 230 : 110)
      )
        return "";
      return `<button class="hotspot ${m.atom !== undefined ? "atom-label" : ""}" style="left:${x}px;top:${y}px" ${m.experimentCell !== undefined ? `data-experiment-cell="${m.experimentCell}"` : m.region ? `data-region="${m.region}"` : m.step !== undefined ? `data-step="${m.step}"` : m.atom !== undefined ? `data-atom="${m.atom}" data-element="${m.element}"` : m.neuron ? "data-neuron-info" : "data-micro-info"}>${m.label}</button>`;
    })
    .join("");
  const holder = $("#scene-labels");
  const signature = html.replace(/style="[^"]*"/g, "");
  if (holder.dataset.signature !== signature) {
    holder.dataset.signature = signature;
    holder.innerHTML = html;
  } else {
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const next = [...temp.children];
    [...holder.children].forEach((el, i) => {
      if (next[i]) el.style.cssText = next[i].style.cssText;
      else el.hidden = true;
    });
  }
}
function neuronInfo() {
  writeDetails(
    "neurons",
    "Neurons",
    `<div class="eyebrow">NEURAL TISSUE · ENLARGED SCHEMATIC</div><h2>Cells beneath<br>the surface.</h2><p>Branching dendrites receive inputs. A cell body integrates them, and an axon carries signals toward synaptic contacts.</p><p>The small heads on dendrites are spines. Nearby axon terminals form representative contacts, with a visible gap between cells.</p><button class="primary" data-neuron-focus>Focus the cells ↗</button><button class="secondary" data-synapse>Inside one synapse →</button><p class="small-note">These procedural neurons are enlarged inside a local atlas window. Their positions, shapes, counts and flashes are illustrative, not measured cells or reconstructed connectivity. The surrounding brain remains reference anatomy.</p>${evidence(["neuron-morphology", "allen"])}`,
    {},
  );
  openInfo();
}
function toggleNeurons() {
  state.neurons = !state.neurons;
  const r = regionBy(state.region);
  const source = r && r.index < 18 ? r : regionBy("motor");
  state.neuronAnchor = source.leftCentroid.slice();
  renderer?.neuron_detail(...state.neuronAnchor, state.neurons);
  $("#neuron-layer").setAttribute("aria-pressed", String(state.neurons));
  if (state.neurons) {
    $("#hemisphere").value = "0";
    setView("whole");
    neuronInfo();
  } else {
    applyCamera(0);
    openInfo(false);
  }
  dirty = true;
}
function applyCamera(n) {
  state.camera = n;
  renderer?.view(n);
  $("#camera-preset").value = String(n);
  $("#orientation-label").textContent = [
    "PERSPECTIVE",
    "LEFT LATERAL",
    "RIGHT LATERAL",
    "SUPERIOR",
    "POSTERIOR",
    "DEEP PERSPECTIVE",
  ][n];
  dirty = true;
}
function viewName() {
  return state.view === "deep"
    ? "Inside · x-ray highlights"
    : state.view === "cut"
      ? "Cutaway"
      : "Whole brain";
}
function setView(view) {
  state.view = view;
  if (state.mode !== "atlas") return;
  renderer?.xray(view === "deep");
  renderer?.hemisphere(+$("#hemisphere").value);
  renderer?.reveal(
    view === "deep" ? 1 : +$("#hemisphere").value,
    view === "cut" ? +$("#cut-depth").value : 2,
  );
  $$(".segmented button").forEach((b) =>
    b.classList.toggle(
      "active",
      b.id ===
        `view-${view === "deep" ? "deep" : view === "cut" ? "cut" : "whole"}`,
    ),
  );
  $("#cut-control").hidden = view !== "cut" || state.mode !== "atlas";
  if (state.mode === "atlas") $("#scale-tag").textContent = viewName();
  dirty = true;
}
function selectRegion(id) {
  openInfo(true);
  const r = regionBy(id);
  if (!r || r.kind === 2) return;
  state.region = id;
  renderer?.select(r.index);
  if (state.mode !== "atlas") {
    state.mode = "atlas";
    setMode();
  }
  if (r.kind === 1 && state.view === "whole") setView("deep");
  const info = content.regions[id];
  writeDetails(
    `region-${id}`,
    r.name,
    `<div class="eyebrow">ANATOMY / ${String(r.index + 1).padStart(2, "0")}</div><h2>${esc(r.name)}</h2><div class="pill">${esc(r.role)}</div><p>${esc(info.summary)}</p><button class="secondary" data-focus="${id}">Focus this region ↗</button><div class="divider"></div><div class="eyebrow">ATLAS MAPPING</div><p>${r.labels.length} reference labels grouped for teaching. Includes ${esc(r.atlasNames.join("; "))}.</p><p class="small-note">This is an anatomical grouping, not an independently mapped functional parcel. A region contributes to multiple processes.</p>${evidence(info.sources)}${state.activity ? '<button class="secondary" data-back-story>Return to the activity →</button>' : ""}`,
    {},
  );
  if (state.tab === "explore") renderRegions($("#region-search")?.value || "");
  dirty = true;
}
function selectActivity(id, time = 0) {
  openInfo(true);
  openExplorer(false);
  const a = content.activities.find((a) => a.id === id);
  if (!a) return;
  state.activity = a;
  state.region = null;
  state.chemical = null;
  state.time = Math.max(0, Math.min(a.duration, time));
  state.chapter = -1;
  state.tab = "activities";
  state.mode = "atlas";
  renderer?.select(-1);
  setTab("activities");
  setView(["music", "reward"].includes(id) ? "deep" : "whole");
  renderer?.view(
    ["music", "reward"].includes(id) ? 5 : id === "vision" ? 4 : 0,
  );
  $("#orientation-label").textContent =
    id === "vision" ? "POSTERIOR" : "PERSPECTIVE";
  showChapter(true);
  updateActivity();
  updateTimeline();
  dirty = true;
}
function showChapter(force = false) {
  const a = state.activity;
  if (!a) return;
  const n = Math.min(
    a.chapters.length - 1,
    Math.floor(state.time / (a.duration / a.chapters.length)),
  );
  if (n === state.chapter && !force) return;
  state.chapter = n;
  const c = a.chapters[n];
  writeDetails(
    `activity-${a.id}`,
    a.short,
    `<div class="eyebrow">${a.number} / ${esc(a.short).toUpperCase()}</div><h2>${esc(c.title)}<em>.</em></h2><div class="pill">CHAPTER ${n + 1} OF ${a.chapters.length}</div><p>${esc(c.text)}</p><div class="chapter-regions">${c.regions.map((id) => `<button data-region="${id}">${esc(regionBy(id)?.name || id)} ↗</button>`).join("")}</div><p class="small-note">Highlight = focus of this explanation. Brightness, duration and connecting marks are authored. Unlit regions are not inactive. Connections are schematic and do not represent measured axons. Inside view shows highlighted structures through their neighbors.</p>${evidence([c.source])}<button class="secondary" data-chemical="${a.chemical}">Explore ${a.chemical} signaling →</button><button class="secondary" data-synapse>Zoom into a synapse ↗</button>`,
    { activate: force },
  );
}
function selectChemical(id) {
  openInfo(true);
  const c = content.chemicals.find((c) => c.id === id);
  if (!c) return;
  state.chemical = c;
  state.region = null;
  state.activity = null;
  state.playing = false;
  state.tab = "chemicals";
  state.mode = "synapse";
  state.step = 1;
  state.microPlaying = !state.reduced;
  renderer?.select(-1);
  $$("[data-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === "chemicals"),
  );
  setMode();
  if (state.mode === "atlas") setView(c.regions.length ? "deep" : "whole");
  renderLeft();
  writeDetails(
    `chemical-${c.id}`,
    c.name,
    `<div class="eyebrow">${esc(c.className)}</div><h2>${esc(c.name)}<em>.</em></h2><p>${esc(c.summary)}</p><div class="mechanisms">${["synthesis", "release", "receptors", "clearance"].map((k, i) => `<div><span class="eyebrow">0${i + 1} / ${k.toUpperCase()}</span><p>${esc(c[k])}</p></div>`).join("")}</div><button class="primary" data-inspect-molecule>Inspect the messenger in 3D ↗</button><button class="secondary" data-brain-map>See pathway context in the brain →</button><p class="small-note">${c.regions.length ? "Highlighted regions provide pathway context, not a map of synthesis rates or concentrations. This selection is incomplete; the ventral tegmental area is not separately segmented in this teaching atlas." : "This messenger is broadly distributed. No activity-specific release field is inferred or shown."}</p>${evidence(c.sources)}<div class="eyebrow">RELATED STORIES</div>${c.activities.map((id) => `<button class="secondary" data-activity="${id}">${esc(content.activities.find((a) => a.id === id).short)} ↗</button>`).join("")}`,
    {},
  );
  updateActivity();
  updateTimeline();
  dirty = true;
}
function updateActivity() {
  const values = new Float32Array(64);
  if (state.mode === "atlas") {
    if (state.tab === "activities" && state.activity) {
      const a = state.activity;
      const span = a.duration / a.chapters.length;
      a.chapters.forEach((c, i) => {
        const local = state.time - i * span;
        let v = wasm
          ? wasm.envelope(state.time, i * span, (i + 1) * span)
          : Math.max(
              0,
              Math.min(1, local / (span * 0.2), (span - local) / (span * 0.2)),
            );
        if (state.reduced && state.chapter === i) v = 0.8;
        c.regions.forEach((id) => {
          const r = regionBy(id);
          if (r) values[r.index] = Math.max(values[r.index], v * 0.8);
        });
      });
    }
    if (state.tab === "chemicals" && state.chemical)
      state.chemical.regions.forEach((id) => {
        const r = regionBy(id);
        if (r) values[r.index] = 0.55;
      });
  }
  renderer?.activity(values);
}
function updateTimeline() {
  document.body.dataset.story =
    state.mode === "atlas" && state.tab === "activities" && state.activity
      ? "on"
      : "off";
  const a =
    state.mode === "atlas" && state.tab === "activities"
      ? state.activity
      : null;
  $("#play").disabled = !a;
  $("#restart").disabled = !a;
  $("#speed").disabled = !a;
  $("#playhead").disabled = !a;
  $("#play").textContent = state.playing ? "Ⅱ" : "▶";
  $("#play").setAttribute(
    "aria-label",
    state.playing ? "Pause activity" : "Play activity",
  );
  $("#timeline-kicker").textContent =
    state.mode === "synapse"
      ? "A SMALLER SCALE"
      : state.mode === "circuit"
        ? "THE NEURAL CIRCUIT"
        : a
          ? "GUIDED STORY · ILLUSTRATIVE"
          : "FOLLOW A SIGNAL";
  $("#timeline-name").textContent =
    state.mode === "synapse"
      ? "A chemical signal, step by step"
      : state.mode === "circuit"
        ? "Two populations. A changing balance."
        : a
          ? a.title
          : "Choose an activity to bring the atlas to life";
  $("#playhead").max = a?.duration || 60;
  $("#playhead").value = a ? state.time : 0;
  $("#elapsed").textContent = fmt(a ? state.time : 0);
  $("#duration").textContent = a ? fmt(a.duration) : "—";
  $("#chapter-caption").textContent = a
    ? a.chapters[state.chapter]?.title || "Ready to explore"
    : state.mode === "circuit"
      ? "Use the controls to run the Rust model"
      : state.mode === "synapse"
        ? "Use Previous and Next to follow the mechanism"
        : "Explore at your own pace";
  $("#chapter-ticks").innerHTML = a
    ? a.chapters
        .map(
          (c, i) =>
            `<button class="chapter-marker ${i === state.chapter ? "active" : ""}" data-chapter="${i}" aria-label="Chapter ${i + 1}: ${esc(c.title)}">0${i + 1}</button>`,
        )
        .join("")
    : "";
}
function seek(t) {
  if (!state.activity) return;
  state.time = Math.min(state.activity.duration, Math.max(0, t));
  showChapter();
  updateActivity();
  updateTimeline();
  dirty = true;
}
function openSynapse() {
  state.parent = state.activity
    ? {
        id: state.activity.id,
        time: state.time,
        camera: state.camera,
        view: state.view,
      }
    : null;
  state.chemical =
    state.chemical ||
    content.chemicals.find(
      (c) => c.id === (state.activity?.chemical || "dopamine"),
    );
  state.mode = "synapse";
  state.tab = "chemicals";
  renderLeft();
  state.playing = false;
  state.circuitPlaying = false;
  state.step = 1;
  state.microPlaying = !state.reduced;
  state.microElapsed = 0;
  state.microClock = 0;
  openExplorer(false);
  openInfo(false);
  setMode();
  showSynapse();
  updateTimeline();
}
function showSynapse() {
  refreshMicro();
  renderer?.micro_state(state.step, 0, 0);
  const c = state.chemical,
    keys = ["synthesis", "release", "receptors", "clearance"],
    k = keys[state.step];
  writeDetails(
    `synapse-${c.id}`,
    `${c.name} synapse`,
    `<div class="eyebrow">${c.name.toUpperCase()} / SYNAPSE</div><h2>${["Make the<br><em>messenger.</em>", "Release the<br><em>signal.</em>", "Meet the<br><em>receptor.</em>", "End and<br><em>recycle.</em>"][state.step]}</h2><div class="pill">STEP ${state.step + 1} OF 4 · ${k.toUpperCase()}</div><p>${esc(c[k])}</p><p>${state.step === 1 ? "In this conventional chemical-synapse schematic, an arriving electrical signal triggers calcium-dependent vesicle release. Actual release can also occur outside a neatly bounded synaptic cleft." : state.step === 2 ? (c.id === "dopamine" ? "Metabotropic receptors act through intracellular signaling; these symbols are not open ion channels." : c.id === "glutamate" ? "Glutamate has both ionotropic and metabotropic receptor families. The pore here illustrates the ionotropic case." : "GABA has ionotropic and metabotropic receptors. This pore represents an ionotropic receptor; the effect depends on ionic gradients.") : ""}</p><div class="step-controls"><button id="syn-prev" class="secondary" ${state.step === 0 ? "disabled" : ""}>← Previous</button><button id="syn-next" class="primary" ${state.step === 3 ? "disabled" : ""}>Next →</button></div>${state.parent ? '<button class="secondary" data-return-activity>Return to the activity →</button>' : ""}<button class="secondary" data-chemical="${c.id}">Chemical details ↗</button><p class="small-note">A generic teaching diagram. Dots represent messenger molecules without implying counts, concentrations, speed or scale. This is an authored mechanism lesson.</p>${evidence(c.sources.slice(0, 2).concat(["neurotransmitters"]))}`,
    { activate: false },
  );
  dirty = true;
}
function chooseSynapseStep(step) {
  state.step = Math.max(0, Math.min(3, step));
  state.microElapsed = 0;
  state.microClock = 0;
  showSynapse();
  dirty = true;
}
function equations() {
  writeDetails(
    "equations",
    "Model evidence",
    `<div class="eyebrow">RUST MODEL / PEDAGOGICAL PARAMETERS</div><h2>Two populations.<br>One feedback system.</h2><pre>dE/dt = (−E + S(10E − gI + P − 2.5)) / 0.08\ndI/dt = (−I + S(10E − 3I − 2)) / 0.12\nS(x)  = 1 / (1 + exp(−x))</pre><p>E and I are normalized excitatory and inhibitory population states. P is external drive (0–5). g is inhibitory coupling (3–15). Initial E = I = 0.1. Time is a model time coordinate in seconds, not a fitted biological timescale.</p><p>Integration uses fixed-step Heun at 0.001 s, independent of display frame rate. Long background pauses do not fast-forward the model. The plot keeps the last 15 model seconds. This two-population teaching adaptation is inspired by Wilson–Cowan; it omits refractory terms and is not a reproduction of a fitted system.</p><p>Send a signal adds a teaching input of 2 drive units with a 0.3-model-second exponential decay, capped at drive 5. The traveling pulses visualize population activity; this model does not compute individual action potentials. No neurotransmitter concentrations, synaptic plasticity, or atlas coupling are modeled.</p>${evidence(["wilson"])}`,
    { reference: true, reveal: true },
  );
}
function drawOverlay(t) {
  const w = overlay.width,
    h = overlay.height,
    d = w / Math.max(1, overlay.clientWidth);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.scale(d, d);
  const W = w / d,
    H = h / d;
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.lineWidth = 1;
  if (state.mode === "synapse" && !renderer) drawSynapse(W, H, t);
  else if (state.mode === "circuit" && !renderer) drawCircuit(W, H);
  else if (state.mode !== "atlas") {
  } else if (renderer) {
    let ids = state.region
      ? [state.region]
      : state.tab === "activities" && state.activity
        ? state.activity.chapters[state.chapter]?.regions || []
        : state.tab === "chemicals"
          ? state.chemical?.regions || []
          : [];
    const points = ids
      .map((id) => {
        const r = regionBy(id);
        if (!r) return null;
        const p = renderer.project(...(r.leftCentroid || r.centroid));
        return { r, x: p[0] / d, y: p[1] / d, z: p[2] };
      })
      .filter(
        (p) =>
          p &&
          p.z > 0 &&
          p.z < 1 &&
          p.x > 10 &&
          p.x < W - 10 &&
          p.y > 50 &&
          p.y < H - 90,
      );
    if (state.paths && !state.region && points.length > 1) {
      ctx.strokeStyle = "#aaaaaa55";
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      points.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const labelY = new Map();
    for (const side of [-1, 1]) {
      const group = points
        .filter((p) => (p.x < W / 2 ? -1 : 1) === side)
        .sort((a, b) => a.y - b.y);
      let previous = 65;
      for (const p of group) {
        const y = Math.max(previous + 28, p.y - 24);
        labelY.set(p, y);
        previous = y;
      }
      const overflow = Math.max(0, previous - (H - 120));
      for (const p of group) labelY.set(p, labelY.get(p) - overflow);
    }
    points.forEach((p, i) => {
      ctx.fillStyle = "#eee";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
      const dir = p.x < W / 2 ? -1 : 1,
        len = Math.min(60, W * 0.1),
        y = labelY.get(p);
      ctx.strokeStyle = "#ffffff66";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + dir * 20, y);
      ctx.lineTo(p.x + dir * len, y);
      ctx.stroke();
      ctx.font = '10px "DM Sans",sans-serif';
      const name = p.r.name;
      const tw = ctx.measureText(name).width;
      const x = Math.min(
        W - tw - 15,
        Math.max(15, dir < 0 ? p.x - len - tw - 6 : p.x + len + 6),
      );
      ctx.fillStyle = "#090909dc";
      ctx.fillRect(x - 5, y - 9, tw + 10, 20);
      ctx.fillStyle = "#ddd";
      ctx.fillText(name, x, y + 4);
    });
  }
  ctx.restore();
  if (state.mode === "atlas" && state.activity && state.paths)
    drawNarrativeFlow();
}
function drawNarrativeFlow() {
  if (!renderer) return;
  const ids = [...new Set(state.activity.chapters.flatMap((ch) => ch.regions))];
  if (ids.length < 2) return;
  const d = overlay.width / overlay.clientWidth;
  const points = ids
    .map((id) => renderer.project(...regionBy(id).leftCentroid))
    .map((p) => [p[0] / d, p[1] / d]);
  ctx.save();
  ctx.scale(d, d);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#ffffff3a";
  for (let i = 0; i < points.length - 1; i++) {
    const [x, y] = points[i],
      [a, b] = points[i + 1];
    const mx = (x + a) / 2 + 45,
      my = (y + b) / 2 - 35;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx, my, a, b);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!state.reduced) {
      const t = (state.time * 0.22 + i * 0.3) % 1,
        u = 1 - t;
      dot(
        u * u * x + 2 * u * t * mx + t * t * a,
        u * u * y + 2 * u * t * my + t * t * b,
        2.1,
        true,
      );
    }
  }
  ctx.restore();
}
function drawSynapse(W, H, t) {
  const center = W * 0.5,
    top = H * 0.31,
    bottom = H * 0.62,
    left = W * 0.14,
    right = W * 0.86;
  ctx.strokeStyle = "#8b8b8b";
  ctx.fillStyle = "#171717";
  ctx.lineWidth = 1.2;
  const terminal = () => {
    ctx.beginPath();
    ctx.moveTo(left, 100);
    ctx.bezierCurveTo(
      left - 15,
      top + 10,
      left + 15,
      top + 35,
      center,
      top + 35,
    );
    ctx.bezierCurveTo(right - 15, top + 35, right + 15, top + 10, right, 100);
    ctx.stroke();
  };
  terminal();
  ctx.strokeStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(left, 105);
  ctx.bezierCurveTo(left - 8, top + 4, left + 20, top + 29, center, top + 29);
  ctx.bezierCurveTo(right - 20, top + 29, right + 8, top + 4, right, 105);
  ctx.stroke();
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, bottom, W, H - bottom);
  ctx.strokeStyle = "#999";
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  ctx.bezierCurveTo(W * 0.3, bottom - 12, W * 0.7, bottom + 12, W, bottom);
  ctx.stroke();
  ctx.strokeStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(0, bottom + 6);
  ctx.bezierCurveTo(W * 0.3, bottom - 6, W * 0.7, bottom + 18, W, bottom + 6);
  ctx.stroke();
  ctx.fillStyle = "#777";
  ctx.font = '9px "IBM Plex Mono",monospace';
  ctx.fillText("PRESYNAPTIC TERMINAL", left, 85);
  ctx.fillText("POSTSYNAPTIC MEMBRANE", left, bottom + 65);
  ctx.fillStyle = "#555";
  ctx.textAlign = "center";
  ctx.fillText("SYNAPTIC CLEFT", center, (top + 35 + bottom) / 2);
  ctx.textAlign = "left";
  for (let i = 0; i < 5; i++) {
    let x = left + 30 + (i * (right - left - 60)) / 4,
      y = top - 38 + Math.sin(i * 2) * 18;
    ctx.strokeStyle = i === 2 && state.step === 1 ? "#fff" : "#555";
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    for (let j = 0; j < 5; j++) {
      const a = j * 2.4;
      dot(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 1.8, state.step === 0);
    }
  }
  for (let i = 0; i < 4; i++) {
    const x = W * 0.28 + i * W * 0.15;
    ctx.fillStyle = "#222";
    ctx.strokeStyle = state.step === 2 ? "#eee" : "#666";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 7, bottom - 13, 14, 27, 4);
    ctx.fill();
    ctx.stroke();
    if (state.chemical.id !== "dopamine") {
      ctx.strokeStyle = "#090909";
      ctx.beginPath();
      ctx.moveTo(x, bottom - 13);
      ctx.lineTo(x, bottom + 14);
      ctx.stroke();
    }
    if (state.step === 2) {
      dot(x, bottom - 21, 3, true);
      ctx.strokeStyle = "#888";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, bottom + 16);
      ctx.lineTo(x, bottom + 43);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (state.step === 1 || state.step === 3) {
    for (let i = 0; i < 15; i++) {
      const phase = state.reduced ? 0.5 : (t * 0.24 + i * 0.067) % 1,
        x = center + Math.sin(i * 13) * W * 0.2,
        y =
          state.step === 1
            ? top + 40 + phase * (bottom - top - 65)
            : bottom - 20 - phase * (bottom - top - 55);
      dot(x + (state.step === 3 ? phase * 35 : 0), y, 2.3, true);
    }
  }
  ctx.fillStyle = "#aaa";
  ctx.font = '11px "DM Sans",sans-serif';
  ctx.fillText(
    state.step === 0
      ? "Vesicles package the messenger"
      : state.step === 1
        ? "Release into extracellular space"
        : state.step === 2
          ? state.chemical.id === "dopamine"
            ? "Receptor → intracellular signaling"
            : "Receptor binding changes signaling"
          : "Transporters and metabolism regulate the signal",
    left,
    H - 80,
  );
  ctx.fillStyle = "#666";
  ctx.font = '8px "IBM Plex Mono",monospace';
  ctx.fillText(
    `${state.chemical.symbol} · ${["SYNTHESIS", "RELEASE", "RECEPTOR ACTION", "CLEARANCE"][state.step]} · ILLUSTRATIVE`,
    left,
    H - 57,
  );
}
function dot(x, y, r, glow) {
  ctx.save();
  ctx.fillStyle = glow ? "#fff" : "#aaa";
  if (glow) {
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 12;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawCircuit(W, H) {
  const a = trace.at(-1) || [0, 0.1, 0.1],
    cy = H * 0.28,
    r = Math.min(W * 0.115, 62),
    xs = [W * 0.3, W * 0.7];
  ctx.textAlign = "center";
  xs.forEach((x, n) => {
    const v = a[n + 1];
    ctx.strokeStyle = n ? "#777" : "#ccc";
    ctx.setLineDash(n ? [4, 4] : []);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 22; i++) {
      const angle = i * 2.399,
        rr = Math.sqrt((i + 0.5) / 22) * r * 0.78;
      dot(
        x + Math.cos(angle) * rr,
        cy + Math.sin(angle) * rr,
        1.3 + v * 1.3,
        !state.reduced && v > 0.4,
      );
    }
    ctx.fillStyle = "#ddd";
    ctx.font = "24px Georgia,serif";
    ctx.fillText(n ? "I" : "E", x, cy + r + 38);
    ctx.font = '9px "IBM Plex Mono",monospace';
    ctx.fillStyle = "#888";
    ctx.fillText(
      `${n ? "INHIBITORY" : "EXCITATORY"} · ${v.toFixed(3)}`,
      x,
      cy + r + 62,
    );
  });
  ctx.strokeStyle = "#777";
  ctx.beginPath();
  ctx.moveTo(xs[0] + r + 10, cy - 12);
  ctx.quadraticCurveTo(W * 0.5, cy - 48, xs[1] - r - 10, cy - 12);
  ctx.stroke();
  ctx.fillStyle = "#aaa";
  ctx.font = "11px monospace";
  ctx.fillText("+", W * 0.5, cy - 36);
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(xs[1] - r - 10, cy + 12);
  ctx.quadraticCurveTo(W * 0.5, cy + 48, xs[0] + r + 10, cy + 12);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText("−", W * 0.5, cy + 42);
  const x0 = 55,
    y0 = H * 0.6,
    pw = W - 95,
    ph = H * 0.23;
  ctx.textAlign = "right";
  ctx.font = '8px "IBM Plex Mono",monospace';
  for (let i = 0; i <= 4; i++) {
    const y = y0 + (i * ph) / 4;
    ctx.strokeStyle = "#242424";
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + pw, y);
    ctx.stroke();
    ctx.fillStyle = "#777";
    ctx.fillText((1 - i / 4).toFixed(2), x0 - 10, y + 3);
  }
  const end = Math.max(15, a[0]),
    start = end - 15;
  [1, 2].forEach((k) => {
    ctx.strokeStyle = k === 1 ? "#eee" : "#888";
    ctx.setLineDash(k === 1 ? [] : [5, 4]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    trace.forEach((p, i) => {
      const x = x0 + ((p[0] - start) / 15) * pw,
        y = y0 + (1 - p[k]) * ph;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.textAlign = "left";
  ctx.fillStyle = "#aaa";
  ctx.font = '9px "IBM Plex Mono",monospace';
  ctx.fillText("NORMALIZED POPULATION STATE", x0, y0 - 20);
  ctx.fillStyle = "#666";
  ctx.fillText(`${start.toFixed(1)} s`, x0, y0 + ph + 20);
  ctx.textAlign = "right";
  ctx.fillText(`${end.toFixed(1)} s`, x0 + pw, y0 + ph + 20);
  ctx.textAlign = "left";
  ctx.fillText("— E    ┄ I     ·     MODEL TIME", x0, H - 48);
}
function bind() {
  document.addEventListener("click", (e) => {
    let b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tab) setTab(b.dataset.tab);
    else if (b.dataset.region) selectRegion(b.dataset.region);
    else if (b.dataset.source) showSource(b.dataset.source);
    else if (b.dataset.activity) selectActivity(b.dataset.activity);
    else if (b.dataset.chemical) {
      if (state.mode === "molecule") openMolecule(b.dataset.chemical);
      else selectChemical(b.dataset.chemical);
    } else if (b.hasAttribute("data-synapse")) openSynapse();
    else if (b.hasAttribute("data-back-story")) showChapter(true);
    else if (b.hasAttribute("data-return-activity") && state.parent) {
      const parent = state.parent;
      selectActivity(parent.id, parent.time);
      setView(parent.view);
      applyCamera(parent.camera);
    } else if (b.dataset.focus) {
      const r = regionBy(b.dataset.focus);
      renderer?.focus(...(r.leftCentroid || r.centroid));
      dirty = true;
    } else if (b.hasAttribute("data-chapter")) {
      seek(
        (+b.dataset.chapter * state.activity.duration) /
          state.activity.chapters.length +
          0.05,
      );
    } else if (b.dataset.pan) {
      renderer?.pan(...b.dataset.pan.split(",").map((n) => +n * 0.04));
      dirty = true;
    } else if (b.id === "start-music") selectActivity("music");
    else if (b.id === "equations") equations();
    else if (b.id === "syn-prev") chooseSynapseStep(state.step - 1);
    else if (b.id === "syn-next") chooseSynapseStep(state.step + 1);
  });
  $("#about-button").onclick = about;
  $(".left-foot").onclick = () => showSource("allen");
  $("#view-whole").onclick = () => setView("whole");
  $("#view-deep").onclick = () => setView("deep");
  $("#view-cut").onclick = () => setView("cut");
  $("#hemisphere").onchange = () => setView(state.view);
  $("#cut-depth").oninput = () => setView("cut");
  $("#camera-preset").onchange = (e) => applyCamera(+e.target.value);
  $("#reset-view").onclick = () => applyCamera(0);
  $("#zoom-in").onclick = () => {
    renderer?.zoom(-0.15);
    dirty = true;
  };
  $("#zoom-out").onclick = () => {
    renderer?.zoom(0.15);
    dirty = true;
  };
  $("#settings-button").onclick = () => {
    const opening = $("#view-settings").hidden;
    if (opening && innerWidth < 821) {
      openExplorer(false);
      openInfo(false);
    }
    $("#view-settings").hidden = !opening;
  };
  $("#glow-control").oninput = (e) => {
    renderer?.glow(+e.target.value);
    dirty = true;
  };
  $("#subtle-colors").onchange = (e) => {
    state.color = e.target.checked;
    renderer?.accents(state.color);
    document.body.dataset.color = state.color ? "on" : "off";
    dirty = true;
  };
  $("#reduced-motion").checked = state.reduced;
  $("#reduced-motion").onchange = (e) => {
    state.reduced = e.target.checked;
    if (state.reduced) {
      state.microPlaying = false;
      state.circuitPlaying = false;
    }
    refreshMicro();
    updateActivity();
    dirty = true;
  };
  $("#show-paths").onchange = (e) => {
    state.paths = e.target.checked;
    dirty = true;
  };
  $("#quality").onchange = (e) => changeQuality(e.target.value);
  $("#play").onclick = () => {
    if (!state.activity) return;
    if (state.time >= state.activity.duration) seek(0);
    state.playing = !state.playing;
    updateTimeline();
  };
  $("#playhead").oninput = (e) => seek(+e.target.value);
  $("#restart").onclick = () => seek(0);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("#view-settings").hidden = true;
    if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
      $("#region-search")?.focus();
      e.preventDefault();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) experiment?.suspend();
    last = 0;
  });
  window.addEventListener("popstate", restoreRoute);
}
function bindCanvas() {
  const c = canvas(),
    pointers = new Map();
  let start = null,
    moved = 0;
  c.onpointerdown = (e) => {
    interactionTime = performance.now();
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    start = [e.clientX, e.clientY];
    moved = 0;
    c.setPointerCapture(e.pointerId);
  };
  c.onpointermove = (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev[0],
      dy = e.clientY - prev[1];
    moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(
        ([id]) => id !== e.pointerId,
      )[1];
      const old = Math.hypot(prev[0] - other[0], prev[1] - other[1]),
        now = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
      if (old > 0 && now > 0) renderer?.zoom(Math.log(old / now));
      renderer?.pan(dx * 0.0007, -dy * 0.0007);
    } else if (e.shiftKey || e.buttons === 2)
      renderer?.pan(dx * 0.001, -dy * 0.001);
    else renderer?.orbit(-dx * 0.005, dy * 0.005);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    dirty = true;
  };
  c.onpointerup = (e) => {
    if (pointers.size === 1 && moved < 6 && start && renderer) {
      const r = c.getBoundingClientRect(),
        n = renderer.pick(
          (e.clientX - r.left) / r.width,
          (e.clientY - r.top) / r.height,
        );
      const region = atlas.regions.find((r) => r.index === n);
      if (state.mode === "atlas" && region) selectRegion(region.id);
      else if (state.mode === "experiment") {
        if (n >= 0 && n < 3) experiment.selectCue(n);
        else if (n === 3) experimentInfo();
      } else if (state.mode !== "atlas") openInfo(true);
    }
    pointers.delete(e.pointerId);
  };
  c.onpointercancel = (e) => pointers.delete(e.pointerId);
  c.oncontextmenu = (e) => e.preventDefault();
  c.onwheel = (e) => {
    interactionTime = performance.now();
    e.preventDefault();
    renderer?.zoom(e.deltaY * 0.001);
    dirty = true;
  };
  c.onkeydown = (e) => {
    const k = e.key;
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "-",
        "Home",
      ].includes(k)
    ) {
      e.preventDefault();
      if (k === "Home") applyCamera(0);
      else if (k === "+" || k === "-") renderer?.zoom(k === "+" ? -0.12 : 0.12);
      else {
        const dx = k === "ArrowLeft" ? -0.08 : k === "ArrowRight" ? 0.08 : 0,
          dy = k === "ArrowUp" ? -0.08 : k === "ArrowDown" ? 0.08 : 0;
        e.shiftKey ? renderer?.pan(dx, dy) : renderer?.orbit(dx, dy);
      }
      dirty = true;
    }
  };
}
async function changeQuality(q) {
  if (state.mode !== "atlas") {
    toast("Detail levels apply to the brain atlas.");
    return;
  }
  const token = ++loadToken,
    previous = state.quality;
  detailAbort?.abort();
  detailAbort = new AbortController();
  $("#load-progress").hidden = false;
  $("#load-progress span").textContent =
    q === "high" ? "Native anatomy · preparing…" : "Loading anatomy…";
  $("#load-progress progress").value = 0;
  try {
    let bytes, count;
    if (q === "high" || q === "fine") {
      const data = await loadNative(
        (progress, m) => {
          $("#load-progress progress").value = progress;
          $("#load-progress span").textContent =
            `${q === "high" ? "Native 0.5 mm" : "Fine detail"} · ${Math.round(progress * 100)}% of ${Math.round(m.compressedBytes / 1e6)} MB`;
        },
        detailAbort.signal,
        q === "high" ? "native" : "fine",
      );
      bytes = data.bytes;
      count = data.meta.triangles;
    } else {
      const res = await fetch("assets/brain.bin", {
        signal: detailAbort.signal,
      });
      if (!res.ok) throw Error("Anatomy unavailable");
      bytes = new Uint8Array(await res.arrayBuffer());
      count = atlas.triangles;
    }
    if (token !== loadToken || state.mode !== "atlas") return;
    renderer?.load_mesh(bytes);
    atlasBytes = bytes;
    state.quality = q;
    resizeView();
    $("#render-stats").textContent =
      `${renderer?.backend()} · Rust · ${count.toLocaleString()} triangles`;
    toast(q === "high" ? "Native-resolution anatomy ready" : "Detail updated");
    dirty = true;
  } catch (e) {
    $("#quality").value = previous;
    toast(e.name === "AbortError" ? "Detail download canceled" : e.message);
  } finally {
    if (token === loadToken) $("#load-progress").hidden = true;
  }
}
function restoreRoute() {
  const p = new URLSearchParams(location.search);
  if (p.has("v") && p.get("v") !== content.version) {
    toast(
      "This link uses another content version; showing the current edition.",
    );
  }
  const tab = p.get("tab") || "explore";
  setTab(tab);
  if (p.has("activity"))
    selectActivity(
      p.get("activity"),
      Number.isFinite(+p.get("t")) ? +p.get("t") : 0,
    );
  if (p.has("chemical")) selectChemical(p.get("chemical"));
  if (p.has("region")) selectRegion(p.get("region"));
  if (["whole", "deep", "cut"].includes(p.get("view"))) setView(p.get("view"));
  if (p.get("mode") === "experiment") openExperiment();
  if (p.get("mode") === "molecule") openMolecule(p.get("chemical"));
  if (p.get("mode") === "synapse") {
    openSynapse();
    state.step = Math.max(0, Math.min(3, parseInt(p.get("step")) || 0));
    if (
      p.has("parent") &&
      content.activities.some((a) => a.id === p.get("parent"))
    )
      state.parent = {
        id: p.get("parent"),
        time: Math.max(0, Math.min(60, +p.get("parentTime") || 0)),
        camera: 5,
        view: "deep",
      };
    showSynapse();
  }
  if (
    p.has("camera") &&
    Number.isInteger(+p.get("camera")) &&
    +p.get("camera") >= 0 &&
    +p.get("camera") <= 5
  )
    applyCamera(+p.get("camera"));
  if (["0", "2", "3"].includes(p.get("hemisphere")))
    $("#hemisphere").value = p.get("hemisphere");
  if (p.has("cut") && Number.isFinite(+p.get("cut")))
    $("#cut-depth").value = Math.max(-0.8, Math.min(0.8, +p.get("cut")));
  setView(state.view);
  if (tab === "circuit") {
    const drive = +p.get("drive"),
      inh = +p.get("inhibition");
    if (p.has("drive") && Number.isFinite(drive))
      state.drive = Math.max(0, Math.min(5, drive));
    if (p.has("inhibition") && Number.isFinite(inh))
      state.inhibition = Math.max(3, Math.min(15, inh));
    renderLeft();
  }
  state.microPlaying = false;
  state.circuitPlaying = false;
  refreshMicro();
  dirty = true;
}
async function boot() {
  [atlas, content] = await Promise.all([
    fetch("assets/atlas.json").then((r) => {
      if (!r.ok) throw Error("Atlas metadata");
      return r.json();
    }),
    fetch("content.json").then((r) => {
      if (!r.ok) throw Error("Content");
      return r.json();
    }),
  ]);
  experiment = new PathwayExperiment($("#pathway-experiment"), {
    invalidate: () => {
      dirty = true;
    },
    explain: experimentInfo,
    announce: toast,
    reduced: () => state.reduced,
  });
  bind();
  bindImmersive();
  renderLeft();
  restoreRoute();
  const resize = () => {
    const c = canvas(),
      r = c.getBoundingClientRect(),
      d =
        state.quality === "low"
          ? 1
          : Math.min(devicePixelRatio, state.quality === "high" ? 2 : 1.5);
    const w = Math.max(1, Math.min(4096, Math.round(r.width * d))),
      h = Math.max(1, Math.min(4096, Math.round(r.height * d)));
    c.width = w;
    c.height = h;
    overlay.width = w;
    overlay.height = h;
    renderer?.resize(w, h);
    if (renderer?.hdr_enabled()) {
      hdrActive = configureHDR(canvas(), renderer, state.light === "auto");
      renderer.hdr_output(hdrActive);
    }
    dirty = true;
  };
  resizeView = resize;
  new ResizeObserver(resize).observe($(".stage"));
  resize();
  try {
    wasm = await import("./pkg/doke.js");
    await wasm.default();
    circuit = new wasm.Circuit();
    experiment.attach(wasm);
    if (state.tab === "circuit") renderLeft();
    const forceGL =
      !navigator.gpu ||
      new URLSearchParams(location.search).get("backend") === "webgl";
    try {
      renderer = await wasm.BrainRenderer.create(
        canvas(),
        forceGL,
        hdrCapable() && state.light === "auto",
      );
    } catch (e) {
      if (forceGL) throw e;
      canvas().replaceWith(canvas().cloneNode());
      renderer = await wasm.BrainRenderer.create(canvas(), true, false);
    }
    const res = await fetch("assets/brain.bin");
    if (!res.ok) throw Error("Anatomy asset unavailable");
    atlasBytes = new Uint8Array(await res.arrayBuffer());
    renderer.load_mesh(atlasBytes);
    hdrActive = configureHDR(canvas(), renderer, state.light === "auto");
    renderer.hdr_output(hdrActive);
    if (hdrActive) {
      try {
        hdrText = new HDRText(
          canvas().getContext("webgpu").getConfiguration().device,
        );
      } catch (e) {
        console.warn("HDR text unavailable", e);
      }
    }
    document.body.dataset.light = hdrActive ? "hdr" : "sdr";
    $("#hdr-status").textContent = hdrActive
      ? "Extended-range canvas active. Brightness depends on your display and system settings."
      : "SDR contrast + bloom. Your screen’s physical brightness range is unchanged.";
    $("#render-stats").textContent =
      `${renderer.backend()} · Rust · ${atlas.triangles.toLocaleString()} triangles`;
    $("#scene-loading").hidden = true;
    resize();
    bindCanvas();
    setView(state.view);
    applyCamera(state.camera);
    if (state.region) renderer.select(regionBy(state.region).index);
    updateActivity();
  } catch (e) {
    gpuError = String(e);
    console.warn("3D view unavailable:", gpuError);
    renderer = null;
    experiment?.attach(wasm);
    $("#scene-loading").innerHTML =
      '<img class="fallback-atlas" src="assets/fallback.png" alt="Reference brain surface, static preview"><div class="fallback-message"><p>Explore through the explanations.</p><span>LIVE 3D IS UNAVAILABLE ON THIS DEVICE</span><small>The anatomy list, activities, chemistry and sources remain available.</small></div>';
    $("#scene-loading").hidden = state.mode !== "atlas";
    $("#render-stats").textContent = "Text explorer · live 3D unavailable";
    bindCanvas();
  }
  if (state.mode !== "atlas") {
    setMode();
  }
  updateTimeline();
  document.documentElement.dataset.ready = "true";
  requestAnimationFrame(frame);
}
function frame(t) {
  const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
  last = t;
  if (!document.hidden) {
    if (state.mode === "experiment" && experiment?.tick(dt, renderer))
      dirty = true;
    if (state.playing && state.activity && state.mode === "atlas") {
      state.time = Math.min(
        state.activity.duration,
        state.time + dt * +$("#speed").value,
      );
      showChapter();
      updateActivity();
      if (t - lastUI > 80) {
        updateTimeline();
        lastUI = t;
      }
      if (state.time >= state.activity.duration) {
        state.playing = false;
        updateTimeline();
      }
      dirty = true;
    }
    if (state.circuitPlaying && state.mode === "circuit" && circuit) {
      clock += dt;
      const n = Math.floor(clock / 0.001);
      clock -= n * 0.001;
      if (n) {
        const p = circuit.advance(
          n,
          Math.min(5, state.drive + state.pulse),
          state.inhibition,
        );
        state.pulse *= Math.exp((-n * 0.001) / 0.3);
        trace.push([...p]);
        if (t - lastUI > 100 && $("#model-readout")) {
          $("#model-readout").textContent =
            `Model time ${p[0].toFixed(3)} s · E ${p[1].toFixed(3)} · I ${p[2].toFixed(3)}`;
          lastUI = t;
        }
        while (trace.length && trace[0][0] < p[0] - 15) trace.shift();
        dirty = true;
      }
    }
    if (state.mode === "synapse" && state.microPlaying) {
      state.microClock += dt;
      state.microElapsed += dt;
      if (state.microElapsed >= 5) {
        state.step = (state.step + 1) % 4;
        state.microElapsed = 0;
        showSynapse();
      }
      renderer?.micro_state(state.step, 0, 0);
      dirty = true;
    }
    if (state.mode === "circuit") {
      const value = trace.at(-1) || [0, 0.1, 0.1];
      renderer?.micro_state(0, value[1], value[2]);
      if (state.circuitPlaying) state.microClock += dt;
    }
    const animateMicro =
      (state.mode === "synapse" && state.microPlaying) ||
      (state.mode === "circuit" && state.circuitPlaying);
    if (state.mode === "atlas" && state.neurons && !state.reduced) dirty = true;
    const floating =
      state.mode === "atlas" && !state.reduced && t - interactionTime > 3500;
    if (floating) {
      renderer?.orbit(dt * 0.012, Math.cos(t * 0.0004) * dt * 0.003);
      dirty = true;
    }
    if (dirty || animateMicro) {
      if (renderer) {
        try {
          renderer.render(
            state.mode === "atlas"
              ? state.reduced
                ? 0
                : t * 0.001
              : state.microClock,
          );
        } catch (e) {
          state.playing = false;
          toast("The graphics device was interrupted. Reload to restore 3D.");
          renderer = null;
        }
      }
      drawOverlay(t * 0.001);
      drawHotspots();
      if (hdrText && textDirty) {
        hdrText.redraw();
        textDirty = false;
      }
      dirty = false;
    }
  }
  requestAnimationFrame(frame);
}
function bindImmersive() {
  document.body.dataset.explorer = "closed";
  document.body.dataset.info = "closed";
  document.body.dataset.color = "on";
  $("#info-panel").append($(".left-panel"), $("#details"));
  $("#panel-browse").onclick = () => openExplorer();
  $("#close-tab").onclick = closePanelTab;
  $("#panel-tabs").onkeydown = (e) => {
    if (
      !e.target.matches('[role="tab"]') ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
    )
      return;
    e.preventDefault();
    const tabs = [...$("#panel-tabs").querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(e.target);
    const next =
      e.key === "Home"
        ? tabs[0]
        : e.key === "End"
          ? tabs.at(-1)
          : tabs[
              (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length
            ];
    next.click();
    next.focus();
  };
  $("#close-panel").onclick = () => {
    openExplorer(false);
    openInfo(false);
  };
  $("#neuron-layer").onclick = toggleNeurons;
  syncPanel();
  $("#scene-labels").onpointerover = () => {
    interactionTime = performance.now();
  };
  $("#close-explorer").onclick = () => openExplorer(false);
  $("#close-info").onclick = () => openInfo(false);
  $("#cancel-detail").onclick = () => detailAbort?.abort();
  $("#micro-play").onclick = () => {
    if (state.mode === "circuit") {
      state.circuitPlaying = !state.circuitPlaying;
      renderLeft();
    } else state.microPlaying = !state.microPlaying;
    last = performance.now();
    dirty = true;
    refreshMicro();
  };
  $("#inspect-molecule").onclick = () => openMolecule();
  $("#focus-cleft").onclick = () => {
    const button = $("#focus-cleft");
    if (button.dataset.focused === "true") {
      renderer?.view(0);
      button.dataset.focused = "false";
      button.textContent = "Focus cleft ⊕";
    } else {
      renderer?.focus(0, 0.02, 0.15);
      button.dataset.focused = "true";
      button.textContent = "Whole synapse ↺";
    }
    dirty = true;
  };
  $("#micro-info").onclick = () => openInfo(true);
  $("#light-mode").onchange = (e) => {
    state.light = e.target.value;
    document.body.dataset.light =
      state.light === "quiet"
        ? "quiet"
        : hdrActive && state.light === "auto"
          ? "hdr"
          : "sdr";
    renderer?.glow(
      state.light === "quiet" ? 0.1 : state.light === "sdr" ? 1.6 : 2.2,
    );
    if (hdrText) hdrText.canvas.hidden = state.light !== "auto";
    if (renderer?.hdr_enabled()) {
      hdrActive = configureHDR(canvas(), renderer, state.light === "auto");
      renderer.hdr_output(hdrActive);
    }
    document.body.dataset.light =
      state.light === "quiet" ? "quiet" : hdrActive ? "hdr" : "sdr";
    $("#hdr-status").textContent = hdrActive
      ? "Extended-range canvas active. Brightness depends on your display and system settings."
      : state.light === "quiet"
        ? "Quiet light: reduced bloom, standard display range."
        : "SDR contrast + bloom. Your screen’s physical brightness range is unchanged.";
    dirty = true;
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tab) {
      openExplorer(true);
      if (b.dataset.tab !== "chemicals") openInfo(false);
    }
    if (b.dataset.scene) {
      if (b.dataset.scene === "atlas") {
        state.mode = "atlas";
        state.circuitPlaying = false;
        state.microPlaying = false;
        setTab("explore");
        openExplorer(false);
        openInfo(false);
      } else if (b.dataset.scene === "experiment") {
        openExperiment();
      } else if (b.dataset.scene === "synapse") {
        openSynapse();
      } else if (b.dataset.scene === "molecule") {
        openMolecule();
      } else {
        setTab("circuit");
        state.circuitPlaying = !state.reduced;
        state.microClock = 0;
        renderLeft();
        openExplorer(false);
        openInfo(false);
        refreshMicro();
      }
    }
    if (b.hasAttribute("data-experiment-cell")) {
      if (+b.dataset.experimentCell < 3)
        experiment.selectCue(+b.dataset.experimentCell);
      else experimentInfo();
      dirty = true;
    }
    if (b.hasAttribute("data-step")) chooseSynapseStep(+b.dataset.step);
    if (b.hasAttribute("data-micro-info") || b.hasAttribute("data-atom"))
      openInfo(true);
    if (b.hasAttribute("data-neuron-info")) neuronInfo();
    if (b.hasAttribute("data-neuron-focus")) {
      renderer?.focus(...state.neuronAnchor);
      renderer?.zoom(-0.2);
      openInfo(false);
      dirty = true;
    }
    if (b.id === "circuit-source") equations();
    if (b.id === "circuit-controls") openExplorer(true);
    if (b.id === "stimulate-circuit") {
      state.pulse = 2;
      state.circuitPlaying = true;
      refreshMicro();
      toast("A brief extra input enters the excitatory population.");
    }
    if (
      b.hasAttribute("data-inspect-molecule") ||
      b.hasAttribute("data-molecule")
    )
      openMolecule(b.dataset.molecule);
    if (b.hasAttribute("data-brain-map")) {
      state.mode = "atlas";
      setMode();
      setView(state.chemical.regions.length ? "deep" : "whole");
      updateActivity();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      openInfo(false);
      openExplorer(false);
    }
    if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
      setTab("explore");
      openExplorer(true);
      $("#region-search")?.focus();
    }
  });
  const invalidateText = () => {
    textDirty = true;
    dirty = true;
  };
  for (const el of [$("#details"), $(".micro-caption")])
    new MutationObserver(invalidateText).observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  new MutationObserver(invalidateText).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-info", "data-explorer", "data-scene", "data-light"],
  });
  $("#info-panel").addEventListener("scroll", invalidateText, true);
  window.addEventListener("resize", invalidateText);
  document.fonts.ready.then(invalidateText);
}
boot().catch((e) => {
  $("#scene-loading").innerHTML =
    "<p>Content could not load.</p><span>Please reload when your connection returns.</span>";
  $("#details").innerHTML =
    "<h2>Unable to load the atlas.</h2><p>Please check your connection and reload.</p>";
  console.error(e);
});
