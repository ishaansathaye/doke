const names = ["A", "B", "C"];
const number = (v, digits = 2) => Number(v).toFixed(digits);

/** UI state belongs to this visit. Timing and plasticity belong to the Rust model. */
export class PathwayExperiment {
  constructor(root, { invalidate, explain, announce, reduced }) {
    this.root = root;
    this.invalidate = invalidate;
    this.explain = explain;
    this.announce = announce;
    this.reduced = reduced;
    this.cue = 0;
    this.order = 1;
    this.gap = 10;
    this.paused = false;
    this.active = false;
    this.baselines = [null, null, null];
    this.probes = [null, null, null];
    this.trained = [false, false, false];
    this.pending = null;
    this.snapshot = null;
    this.uiElapsed = 0;
    this.mount();
  }

  mount() {
    this.root.innerHTML = `
      <div class="experiment-heading">
        <div><span class="eyebrow">A SMALL EXPERIMENT IN TIMING</span><h1>Teach a <em>pathway.</em></h1></div>
        <button class="experiment-evidence" data-experiment-action="evidence">How it works <span>↗</span></button>
      </div>
      <div class="experiment-guide" aria-label="Experiment guide">
        <span data-guide="0"><b>01</b> Probe</span><i>→</i><span data-guide="1"><b>02</b> Pair</span><i>→</i><span data-guide="2"><b>03</b> Probe again</span>
        <p id="experiment-prompt">Probe a cue, change its timing, then test what changed.</p>
      </div>
      <section class="experiment-dock" aria-label="Pathway experiment controls">
        <div class="experiment-results" aria-label="Pathway efficacy and probe results">
          ${names.map((name, cue) => `<button class="pathway-card" data-experiment-cue="${cue}" aria-pressed="${cue === 0}" aria-label="Select cue ${name}"><span class="pathway-name"><b>${name}</b><span>Cue ${name}<small data-cue-response="${cue}">Not probed</small></span><output data-cue-weight="${cue}">—</output></span><span class="pathway-meter" aria-hidden="true"><span data-cue-fill="${cue}"></span><i data-cue-baseline="${cue}" hidden></i></span></button>`).join("")}
          <div class="experiment-key">Connection efficacy <span>0 → 1</span></div>
        </div>
        <div class="experiment-actions">
          <div class="experiment-timing">
            <label for="experiment-order">Pairing order</label>
            <select id="experiment-order" aria-label="Pairing order"><option value="1">Cue arrives first</option><option value="-1">Target spikes first</option></select>
            <label class="sr-only" for="experiment-gap">Time between spikes</label>
            <select id="experiment-gap" aria-label="Time between spikes"><option value="10">10 ms apart</option><option value="50">50 ms apart</option></select>
          </div>
          <div class="experiment-buttons">
            <button class="experiment-primary" data-experiment-action="probe">Probe cue A <span>↗</span></button>
            <button data-experiment-action="train">Pair × 8 <span>⤳</span></button>
            <button data-experiment-action="pause" aria-label="Pause experiment" disabled>Pause</button>
            <button data-experiment-action="cancel" disabled>Cancel</button>
            <button data-experiment-action="reset" aria-label="Reset experiment">↺ <span>Reset</span></button>
          </div>
        </div>
        <div class="experiment-status"><span id="experiment-status" role="status" aria-live="polite">Preparing the experiment…</span><span id="experiment-clock">0.1× playback · model ms</span></div>
      </section>
      <p class="experiment-boundary">Four schematic cells. A bounded timing rule. <button data-experiment-action="evidence">What this can tell us ↗</button></p>`;
    this.root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.experimentCue !== undefined)
        this.selectCue(+button.dataset.experimentCue);
      const action = button.dataset.experimentAction;
      if (action === "evidence") this.explain();
      else if (action === "train") this.start("training");
      else if (action === "probe") this.start("probe");
      else if (action === "pause") this.togglePause();
      else if (action === "cancel") this.cancel();
      else if (action === "reset") this.reset();
    });
    this.root.querySelector("#experiment-order").onchange = (e) => {
      this.order = +e.target.value;
      this.render();
    };
    this.root.querySelector("#experiment-gap").onchange = (e) => {
      this.gap = +e.target.value;
      this.render();
    };
  }

  attach(wasm) {
    if (wasm?.TimingExperiment) {
      this.model = new wasm.TimingExperiment();
      this.read();
    }
    this.render();
  }

  read() {
    this.snapshot = JSON.parse(this.model.snapshot());
    return this.snapshot;
  }

  enter() {
    this.active = true;
    this.root.hidden = false;
    this.render();
  }

  leave() {
    if (this.busy) this.paused = true;
    this.active = false;
    this.root.hidden = true;
  }

  get busy() {
    return this.snapshot && this.snapshot.phase !== "idle";
  }

  selectCue(cue) {
    if (this.busy || !Number.isInteger(cue) || cue < 0 || cue > 2) return;
    this.cue = cue;
    this.render();
    this.invalidate();
  }

  start(kind) {
    if (!this.model || this.busy) return;
    try {
      if (kind === "training")
        this.model.train(this.cue, this.order * this.gap, 8);
      else this.model.probe(this.cue);
      this.pending = { kind, cue: this.cue };
      this.paused = false;
      this.read();
      this.render();
      this.invalidate();
    } catch (error) {
      this.announce(String(error));
    }
  }

  togglePause() {
    if (!this.busy) return;
    this.paused = !this.paused;
    this.render();
    this.invalidate();
  }

  suspend() {
    if (this.busy) {
      this.paused = true;
      this.render();
    }
  }

  cancel() {
    if (!this.model || !this.busy) return;
    if (this.pending?.kind === "training" && this.snapshot.completed_pairs > 0)
      this.trained[this.pending.cue] = true;
    this.model.cancel();
    this.pending = null;
    this.paused = false;
    this.read();
    this.render("Cancelled. Changes already made are kept.");
    this.invalidate();
  }

  reset() {
    if (!this.model) return;
    this.model.reset();
    this.pending = null;
    this.paused = false;
    this.baselines.fill(null);
    this.probes.fill(null);
    this.trained.fill(false);
    this.read();
    this.render("Preparation reset. All three cues start equally.");
    this.invalidate();
  }

  tick(dt, renderer) {
    if (!this.active || !this.model) return false;
    const running = this.busy && !this.paused;
    if (running) {
      try {
        this.model.advance(Math.min(dt * 100, 50));
        this.read();
        if (!this.busy && this.pending) {
          if (this.pending.kind === "probe") {
            const result = this.snapshot.last_probe;
            if (result) {
              this.probes[result.cue] = { ...result };
              if (!this.baselines[result.cue])
                this.baselines[result.cue] = { ...result };
            }
          } else this.trained[this.pending.cue] = true;
          this.pending = null;
          this.render();
        }
      } catch (error) {
        this.paused = true;
        this.announce(String(error));
      }
      this.uiElapsed += dt;
      if (this.uiElapsed > 0.1) {
        this.render();
        this.uiElapsed = 0;
      }
    }
    if (renderer?.experiment_state) {
      renderer.experiment_state(
        JSON.stringify({
          ...this.snapshot,
          reduced_motion: this.reduced(),
          ui_selected_cue: this.cue,
        }),
      );
    }
    return !!running;
  }

  render(message) {
    const s = this.snapshot;
    const available = !!this.model;
    const busy = !!this.busy;
    const action = (name) =>
      this.root.querySelector(`[data-experiment-action="${name}"]`);
    action("probe").innerHTML = `Probe cue ${names[this.cue]} <span>↗</span>`;
    action("probe").disabled = !available || busy;
    action("train").disabled = !available || busy;
    action("pause").disabled = !busy;
    action("pause").textContent = this.paused ? "Resume" : "Pause";
    action("pause").setAttribute(
      "aria-label",
      this.paused ? "Resume experiment" : "Pause experiment",
    );
    action("cancel").disabled = !busy;
    action("reset").disabled = !available;
    this.root.querySelectorAll("select").forEach((element) => {
      element.disabled = busy || !available;
    });
    this.root.querySelectorAll("[data-experiment-cue]").forEach((button) => {
      const cue = +button.dataset.experimentCue;
      button.disabled = busy;
      button.setAttribute("aria-pressed", String(this.cue === cue));
      const weight = s?.weights[cue];
      this.root.querySelector(`[data-cue-weight="${cue}"]`).textContent =
        available ? number(weight) : "—";
      this.root.querySelector(`[data-cue-fill="${cue}"]`).style.width =
        `${(weight || 0) * 100}%`;
      const baseline = this.baselines[cue];
      const latest = this.probes[cue];
      const marker = this.root.querySelector(`[data-cue-baseline="${cue}"]`);
      marker.hidden = !baseline;
      if (baseline) marker.style.left = `${baseline.weight * 100}%`;
      this.root.querySelector(`[data-cue-response="${cue}"]`).textContent =
        latest
          ? `Last probe: ${latest.spiked ? "fired" : "no spike"}${Math.abs(latest.weight - weight) > 0.0001 ? " *" : ""}`
          : "Not probed";
    });
    const base = this.baselines[this.cue];
    const latest = this.probes[this.cue];
    const trained = this.trained[this.cue];
    const stale =
      latest && Math.abs(latest.weight - s.weights[this.cue]) > 0.0001;
    const changed =
      latest &&
      base &&
      latest !== base &&
      Math.abs(latest.weight - base.weight) > 0.0001;
    const step = !base ? 0 : !trained ? 1 : 2;
    action("probe").classList.toggle("experiment-primary", step !== 1);
    action("train").classList.toggle("experiment-primary", step === 1);
    this.root
      .querySelectorAll("[data-guide]")
      .forEach((node) =>
        node.classList.toggle("current", +node.dataset.guide === step),
      );
    const prompt = !base
      ? `Start with a probe of cue ${names[this.cue]}. This records a comparison for the current preparation.`
      : !trained
        ? "Now pair the cue and target. Their order changes the connection."
        : stale
          ? "Connection changed. Probe again to measure its new response, with learning off."
          : changed
            ? "Same cue, changed connection. Reverse the order, or try an untouched cue."
            : "Probe again. This time the cue acts alone, with learning switched off.";
    this.root.querySelector("#experiment-prompt").textContent = prompt;
    const status = !available
      ? "The experiment model is unavailable. Reload to try again; the evidence remains accessible."
      : busy
        ? `${this.paused ? "Paused · " : ""}${s.phase === "training" ? `Pairing ${names[this.cue]} · ${s.completed_pairs} / ${s.total_pairs} pairs` : `Probing ${names[this.cue]} · learning off`}`
        : stale
          ? `Last probe: ${number(latest.peak_mv, 1)} mV · connection changed since then. Probe again.`
          : changed
            ? `Cue ${names[this.cue]}: ${number(base.peak_mv, 1)} → ${number(latest.peak_mv, 1)} mV peak · ${base.spiked ? "fired" : "no spike"} → ${latest.spiked ? "fired" : "no spike"}`
            : latest
              ? `Cue ${names[this.cue]} probe: ${number(latest.peak_mv, 1)} mV peak · ${latest.spiked ? "target fired" : "target stayed below threshold"}`
              : "Pairing sets both spike times. Probing tests the cue alone.";
    const statusElement = this.root.querySelector("#experiment-status");
    if (statusElement.textContent !== (message || status))
      statusElement.textContent = message || status;
    this.root.querySelector("#experiment-clock").textContent =
      `${s ? Math.round(s.time_ms).toLocaleString() + " ms · " : ""}0.1× playback`;
    this.root.dataset.running = String(busy && !this.paused);
    this.root.dataset.reduced = String(this.reduced());
  }
}
