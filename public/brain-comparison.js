import { configureHDR, hdrCapable } from "./display.js";

/** A source-guided atlas tour. Its authored clock never consumes silicon ticks. */
export async function initBrainComparison(wasm) {
  const $ = (selector) => document.querySelector(selector);
  let canvas = $("#brain-canvas");
  if (!canvas) throw new Error("Comparison atlas canvas is missing");
  window.dokeBrainComparison?.dispose?.();
  const controls = {
    title: $("#brain-guide-title"),
    copy: $("#brain-guide-copy"),
    time: $("#brain-guide-time"),
    play: $("#brain-guide-play"),
    next: $("#brain-guide-next"),
    reset: $("#brain-guide-reset"),
    evidence: $("#brain-guide-evidence"),
    stimulus: $("#brain-stimulus"),
  };
  const abort = new AbortController();
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = $("#reduce-motion")?.checked ?? reducedQuery.matches;
  let renderer = null;
  let comparison = null;
  let atlas = null;
  let elapsed = 0;
  let playing = false;
  let ready = false;
  let disposed = false;
  let error = null;
  let hdr = false;
  let dirty = true;
  let frameId = 0;
  let lastFrame = null;
  let lastStage = -1;
  let lastTimeText = "";
  let resizeObserver = null;
  let pointers = new Map();
  let pinchDistance = null;
  let lastInputKey = "";
  let input = Array(64).fill(0);
  let selectedRegion = null;
  let cutaway = "whole";
  let quality = "overview";
  let requestedQuality = "overview";
  let qualityLoading = false;
  let qualityError = null;
  let qualityToken = 0;
  let qualityAbort = null;
  let overviewMesh = null;
  let activeMesh = null;
  const listen = (target, type, handler, options = {}) =>
    target?.addEventListener(type, handler, {
      ...options,
      signal: abort.signal,
    });
  const duration = () => comparison?.brain?.durationSeconds || 16;
  const stages = () => comparison?.brain?.stages || [];
  const stageIndex = () => {
    const index = stages().findIndex((stage) => elapsed < stage.endSeconds);
    return index < 0 ? Math.max(0, stages().length - 1) : index;
  };
  const currentStage = () => stages()[stageIndex()];

  function snapshot() {
    return {
      ready,
      disposed,
      error,
      playing,
      time: elapsed,
      duration: duration(),
      timing: "Guide time · authored pacing",
      stageIndex: stageIndex(),
      stageId: currentStage()?.id || null,
      regions: [...(currentStage()?.regions || [])],
      input: [...input],
      reducedMotion: reduced,
      hdr,
      backend: renderer?.backend() || null,
      quality,
      requestedQuality,
      qualityLoading,
      qualityError,
      selectedRegion,
      cutaway,
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
    };
  }
  function selectRegion(id, focus = false) {
    const region = atlas?.regions.find((item) => item.id === id);
    if (!region || !renderer || !ready || disposed) return false;
    selectedRegion = id;
    renderer.select(region.index);
    if (focus && Array.isArray(region.centroid))
      renderer.focus(...region.centroid);
    evidence(region);
    dirty = true;
    return true;
  }
  function setCutaway(mode = "whole") {
    const views = { whole: [0, 2], left: [2, 2], right: [3, 2], deep: [1, 2] };
    if (!Object.hasOwn(views, mode))
      throw new RangeError("Unknown anatomical view");
    cutaway = mode;
    renderer?.reveal(...views[mode]);
    dirty = true;
  }
  function resetView() {
    if (disposed) return;
    selectedRegion = null;
    renderer?.select(-1);
    setCutaway("whole");
    initialView();
  }
  function loadingStatus(message, failure = false) {
    const element = $("#brain-loading");
    if (!element) return;
    element.hidden = !message;
    element.textContent = message || "";
    element.dataset.error = String(failure);
  }
  function qualityStatus(message) {
    const element = $("#quality-status");
    if (element) element.textContent = message;
  }
  async function boundedBytes(response, limit, signal) {
    if (!response.ok)
      throw Error(`Atlas download unavailable (${response.status})`);
    const reader = response.body?.getReader();
    if (!reader) throw Error("Atlas download stream unavailable");
    const parts = [];
    let length = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw Error("Atlas data exceeds its declared size");
        parts.push(value);
      }
      signal.throwIfAborted();
    } catch (cause) {
      await reader.cancel().catch(() => {});
      throw cause;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return bytes;
  }
  async function sha256(bytes) {
    if (!crypto.subtle)
      throw Error("Secure checksums are unavailable in this browser");
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  }
  async function detailedMesh(tier, signal, progress) {
    if (!globalThis.DecompressionStream)
      throw Error(
        "This browser cannot decode detailed anatomy; Overview is still available",
      );
    const response = await fetch(`assets/${tier}/manifest.json`, { signal });
    const raw = await boundedBytes(response, 65536, signal);
    const meta = JSON.parse(new TextDecoder().decode(raw));
    const integer = (n, low, high) =>
      Number.isSafeInteger(n) && n >= low && n <= high;
    const hash = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
    if (
      meta.encoding !== "gzip-chunks" ||
      !integer(meta.bytes, 16, 200_000_000) ||
      !integer(meta.compressedBytes, 1, 120_000_000) ||
      !integer(meta.triangles, 1, 6_000_000) ||
      !hash(meta.meshHash) ||
      !Array.isArray(meta.chunks) ||
      meta.chunks.length < 1 ||
      meta.chunks.length > 32
    )
      throw Error("Invalid anatomy manifest");
    let decodedTotal = 0,
      compressedTotal = 0;
    const urls = new Set();
    for (const part of meta.chunks) {
      if (
        !integer(part.bytes, 1, 12_000_000) ||
        !integer(part.decodedBytes, 1, 9_000_000) ||
        !hash(part.sha256) ||
        typeof part.url !== "string" ||
        !new RegExp(`^assets/${tier}/part-[0-9]{3}\\.brnz$`).test(part.url) ||
        urls.has(part.url)
      )
        throw Error("Invalid anatomy chunk manifest");
      urls.add(part.url);
      decodedTotal += part.decodedBytes;
      compressedTotal += part.bytes;
    }
    if (decodedTotal !== meta.bytes || compressedTotal !== meta.compressedBytes)
      throw Error("Anatomy manifest totals do not match");
    const bytes = new Uint8Array(meta.bytes);
    let offset = 0,
      downloaded = 0;
    for (const part of meta.chunks) {
      signal.throwIfAborted();
      const response = await fetch(part.url, { signal });
      const compressed = await boundedBytes(response, part.bytes, signal);
      if (compressed.length !== part.bytes)
        throw Error("Incomplete anatomy chunk");
      if ((await sha256(compressed)) !== part.sha256)
        throw Error("Anatomy chunk checksum mismatch");
      signal.throwIfAborted();
      const decoded = await boundedBytes(
        new Response(
          new Blob([compressed])
            .stream()
            .pipeThrough(new DecompressionStream("gzip")),
        ),
        part.decodedBytes,
        signal,
      );
      if (decoded.length !== part.decodedBytes)
        throw Error("Anatomy chunk decoded size mismatch");
      bytes.set(decoded, offset);
      offset += decoded.length;
      downloaded += part.bytes;
      progress(downloaded / meta.compressedBytes, meta);
    }
    if ((await sha256(bytes)) !== meta.meshHash)
      throw Error("Anatomy mesh checksum mismatch");
    signal.throwIfAborted();
    const header = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    if (
      new TextDecoder().decode(bytes.subarray(0, 4)) !== "BRN1" ||
      header.getUint32(8, true) / 3 !== meta.triangles
    )
      throw Error("Anatomy mesh does not match its manifest");
    return bytes;
  }
  async function setQuality(tier) {
    if (!["overview", "fine", "native"].includes(tier))
      throw new RangeError("Unknown brain quality");
    if (disposed || !ready || !renderer) return false;
    const token = ++qualityToken;
    qualityAbort?.abort();
    qualityAbort = new AbortController();
    const signal = qualityAbort.signal;
    requestedQuality = tier;
    qualityLoading = true;
    qualityError = null;
    qualityStatus(`Preparing ${tier} anatomy…`);
    try {
      const bytes =
        tier === quality
          ? activeMesh
          : tier === "overview"
            ? overviewMesh
            : await detailedMesh(tier, signal, (fraction, meta) => {
                if (token === qualityToken && !disposed)
                  qualityStatus(
                    `${tier === "native" ? "Native" : "Fine"} anatomy · ${Math.round(fraction * 100)}% of ${Math.round(meta.compressedBytes / 1e6)} MB`,
                  );
              });
      signal.throwIfAborted();
      if (disposed || token !== qualityToken) return false;
      if (bytes !== activeMesh) renderer.load_mesh(bytes);
      activeMesh = bytes;
      quality = tier;
      const select = $("#brain-quality");
      if (select) select.value = quality;
      qualityStatus(
        `${quality[0].toUpperCase() + quality.slice(1)} · ${renderer.triangle_count().toLocaleString()} triangles`,
      );
      highlight();
      dirty = true;
      return true;
    } catch (cause) {
      if (token !== qualityToken || disposed) return false;
      qualityError =
        cause.name === "AbortError"
          ? "Detail download canceled"
          : cause.message || String(cause);
      requestedQuality = quality;
      const select = $("#brain-quality");
      if (select) select.value = quality;
      qualityStatus(`${qualityError}. Keeping ${quality} anatomy.`);
      return false;
    } finally {
      if (token === qualityToken) qualityLoading = false;
    }
  }
  function drawStimulus(values) {
    if (
      !Array.isArray(values) ||
      values.length !== 64 ||
      values.some((v) => !Number.isFinite(v) || v < -8 || v > 8)
    )
      return;
    const key = values.join(",");
    if (key === lastInputKey) return;
    lastInputKey = key;
    input = [...values];
    const element = controls.stimulus;
    if (!element) return;
    // An actual copy of the same matrix, never a predicted neural response.
    element.setAttribute(
      "aria-label",
      "The same 8 by 8 input image shown on the silicon side. It does not drive a brain simulation.",
    );
    if (!(element instanceof HTMLCanvasElement)) return;
    const context = element.getContext("2d");
    if (!context) return;
    const width = element.width || 128;
    const height = element.height || 128;
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < 64; i++) {
      const value = values[i];
      context.fillStyle =
        value < 0
          ? `rgb(${35 + Math.min(8, -value) * 12},${46 + Math.min(8, -value) * 7},${54 + Math.min(8, -value) * 4})`
          : `rgb(${27 + value * 26},${34 + value * 26},${35 + value * 25})`;
      context.fillRect(
        ((i % 8) * width) / 8 + 1,
        (Math.floor(i / 8) * height) / 8 + 1,
        width / 8 - 2,
        height / 8 - 2,
      );
    }
    element.dataset.input = key;
  }
  function highlight() {
    if (!renderer || !atlas) return;
    const values = new Float32Array(64);
    for (const id of $("#brain-guide")?.hidden
      ? []
      : currentStage()?.regions || []) {
      const region = atlas.regions.find((region) => region.id === id);
      if (region) values[region.index] = 0.65;
    }
    renderer.activity(values);
    dirty = true;
  }
  function update() {
    const stage = currentStage();
    const index = stageIndex();
    if (stage && index !== lastStage) {
      lastStage = index;
      if (controls.title) controls.title.textContent = stage.title;
      if (controls.copy)
        controls.copy.textContent =
          stage.text +
          (error && !ready
            ? " 3D is unavailable; the guide and evidence still work."
            : "");
      highlight();
    }
    const text = `${elapsed.toFixed(1)} / ${duration()} s · guide time`;
    if (controls.time && text !== lastTimeText) {
      controls.time.textContent = text;
      controls.time.title =
        "Authored reading pace, not measured neural response time.";
      lastTimeText = text;
    }
    if (controls.play) {
      controls.play.textContent = playing
        ? "Pause guide"
        : elapsed >= duration()
          ? "Replay guide"
          : "Play guide";
      controls.play.disabled = !comparison;
      controls.play.setAttribute("aria-pressed", String(playing));
    }
    if (controls.next)
      controls.next.disabled = !comparison || index >= stages().length - 1;
    if (controls.reset) controls.reset.disabled = !comparison;
    if (controls.evidence) controls.evidence.disabled = !comparison;
    canvas.dataset.guideStage = stage?.id || "loading";
    canvas.dataset.guidePlaying = String(playing);
  }
  function play() {
    if (disposed || !comparison || document.hidden) return;
    if (elapsed >= duration()) {
      elapsed = 0;
      lastStage = -1;
    }
    playing = true;
    lastFrame = null;
    update();
  }
  function pause() {
    playing = false;
    lastFrame = null;
    update();
  }
  function next() {
    if (!comparison || disposed) return;
    pause();
    elapsed =
      stages()[Math.min(stageIndex() + 1, stages().length - 1)].startSeconds;
    update();
  }
  function reset() {
    if (disposed) return;
    playing = false;
    elapsed = 0;
    lastFrame = null;
    lastStage = -1;
    selectedRegion = null;
    renderer?.select(-1);
    update();
  }
  function evidence(region = null) {
    if (!comparison) return;
    const stage = currentStage();
    const sourceIds = [
      ...new Set(
        region
          ? ["atlas", ...(stage?.sources || [])]
          : ["atlas", ...(stage?.sources || []), "vision-timing", "bold"],
      ),
    ];
    const sources = sourceIds.map((id) => ({ id, ...comparison.sources[id] }));
    const title = region ? region.name : stage?.title || comparison.title;
    const paragraphs = region
      ? [
          `Anatomical reference: ${region.name}. This teaching surface groups atlas labels; it is not a measured response to your image.`,
          comparison.brain.scope,
        ]
      : [
          stage?.text || comparison.summary,
          comparison.brain.scope,
          "The 16-second clock is authored reading pace. Silicon model ticks, physiological response times and this guide clock are independent.",
        ];
    const attribution = atlas
      ? `${atlas.attribution} License: ${atlas.license}.`
      : "";
    if (attribution) paragraphs.push(attribution);
    window.dispatchEvent(
      new CustomEvent("doke-comparison-evidence", {
        detail: {
          regionId: region?.id || null,
          region: region ? structuredClone(region) : null,
          title,
          sourceIds,
          sources,
          scope: comparison.brain.scope,
          attribution,
          panel: {
            id: region
              ? `brain-region:${region.id}`
              : `brain-guide:${stage?.id || "overview"}`,
            title,
            eyebrow: "ANATOMICAL CONTEXT · FOLLOW THE EVIDENCE",
            paragraphs,
            sources,
          },
        },
      }),
    );
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const mode = $("#resolution")?.value || "sharp";
    const dpr = devicePixelRatio || 1;
    const pixelRatio =
      mode === "balanced"
        ? Math.min(dpr, 1.5)
        : mode === "ultra"
          ? Math.max(3, dpr * 1.75)
          : Math.max(2, dpr * 1.25);
    const wantedWidth = Math.max(1, rect.width * pixelRatio);
    const wantedHeight = Math.max(1, rect.height * pixelRatio);
    const fit = Math.min(
      1,
      4096 / wantedWidth,
      4096 / wantedHeight,
      Math.sqrt(12_000_000 / (wantedWidth * wantedHeight)),
    );
    const width = Math.max(1, Math.floor(wantedWidth * fit));
    const height = Math.max(1, Math.floor(wantedHeight * fit));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (renderer) {
      renderer.resize(width, height);
      updateLight();
    }
    if (
      document.body.dataset.world === "brain" &&
      renderer &&
      $("#render-status")
    )
      $("#render-status").textContent =
        renderer.backend() + " · " + width.toLocaleString() + " px";
    dirty = true;
  }
  function updateLight() {
    const mode = $("#light-mode")?.value || "auto";
    hdr = configureHDR(canvas, renderer, mode === "auto");
    renderer?.hdr_output(hdr);
    renderer?.glow(mode === "quiet" ? 0.25 : reduced ? 0.8 : 1.3);
    dirty = true;
  }
  function initialView() {
    renderer?.view(5);
    renderer?.orbit(0, -0.35);
    dirty = true;
  }
  function bindCanvas() {
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      "Reference brain atlas. Drag to orbit, pinch or scroll to zoom. Arrow keys orbit, plus and minus zoom, Home resets the camera. The guide highlights anatomical landmarks, not a simulated response.",
    );
    canvas.style.touchAction = "none";
    listen(canvas, "pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: pointers.size > 0,
      });
      if (pointers.size > 1) {
        for (const point of pointers.values()) point.moved = true;
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    listen(canvas, "pointermove", (event) => {
      const point = pointers.get(event.pointerId);
      if (!point) return;
      const dx = event.clientX - point.x,
        dy = event.clientY - point.y;
      point.x = event.clientX;
      point.y = event.clientY;
      if (Math.hypot(point.x - point.startX, point.y - point.startY) > 4)
        point.moved = true;
      if (pointers.size > 1) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 0 && pinchDistance > 0)
          renderer?.zoom(Math.log(pinchDistance / distance));
        pinchDistance = distance;
      } else renderer?.orbit(dx * 0.005, dy * 0.005);
      dirty = true;
    });
    listen(canvas, "pointerup", (event) => {
      const point = pointers.get(event.pointerId);
      if (point && !point.moved && renderer && atlas) {
        const rect = canvas.getBoundingClientRect();
        if (rect.width && rect.height) {
          const index = renderer.pick(
            (event.clientX - rect.left) / rect.width,
            (event.clientY - rect.top) / rect.height,
          );
          const region = atlas.regions.find((region) => region.index === index);
          if (region) selectRegion(region.id);
        }
      }
      pointers.delete(event.pointerId);
      pinchDistance = null;
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      pinchDistance = null;
    };
    listen(canvas, "pointercancel", release);
    listen(canvas, "lostpointercapture", release);
    listen(
      canvas,
      "wheel",
      (event) => {
        event.preventDefault();
        renderer?.zoom(Math.max(-0.2, Math.min(0.2, event.deltaY * 0.001)));
        dirty = true;
      },
      { passive: false },
    );
    listen(canvas, "keydown", (event) => {
      const move = {
        ArrowLeft: [-0.1, 0],
        ArrowRight: [0.1, 0],
        ArrowUp: [0, -0.1],
        ArrowDown: [0, 0.1],
      }[event.key];
      if (move) {
        event.preventDefault();
        renderer?.orbit(...move);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        renderer?.zoom(-0.15);
      } else if (event.key === "-") {
        event.preventDefault();
        renderer?.zoom(0.15);
      } else if (event.key === "Home") {
        event.preventDefault();
        initialView();
      } else if (event.key === "Enter") evidence();
      else return;
      dirty = true;
    });
  }
  function frame(now) {
    if (disposed) return;
    const dt =
      lastFrame === null
        ? 0
        : Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!document.hidden) {
      if (playing) {
        elapsed = Math.min(duration(), elapsed + dt);
        if (elapsed >= duration()) playing = false;
        update();
      }
      if (dirty && renderer) {
        try {
          renderer.render(0);
        } catch (cause) {
          error = `Atlas graphics interrupted: ${cause?.message || cause}`;
          ready = false;
          pause();
          canvas.dataset.error = error;
          canvas.dataset.ready = "false";
          loadingStatus(
            "The 3D atlas is unavailable. Reload to retry; anatomy and evidence remain available.",
            true,
          );
          if (controls.copy)
            controls.copy.textContent = `${error}. Reload to restore the 3D view. The evidence remains available.`;
        }
        dirty = false;
      }
    }
    frameId = requestAnimationFrame(frame);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    playing = false;
    cancelAnimationFrame(frameId);
    abort.abort();
    qualityToken++;
    qualityAbort?.abort();
    qualityLoading = false;
    overviewMesh = null;
    activeMesh = null;
    resizeObserver?.disconnect();
    pointers.clear();
    renderer?.free?.();
    renderer = null;
    ready = false;
    canvas.dataset.ready = "false";
    canvas.dataset.disposed = "true";
  }
  const controller = {
    play,
    pause,
    next,
    reset,
    dispose,
    snapshot,
    getRenderer: () => renderer,
    getAtlas: () => (atlas ? structuredClone(atlas) : null),
    selectRegion,
    setCutaway,
    resetView,
    redraw: () => {
      resize();
      highlight();
      dirty = true;
    },
    setQuality,
    get state() {
      return snapshot();
    },
    get renderer() {
      return renderer;
    },
  };
  window.dokeBrainComparison = controller;
  listen(controls.play, "click", () => (playing ? pause() : play()));
  listen(controls.next, "click", next);
  listen(controls.reset, "click", reset);
  listen(controls.evidence, "click", () => evidence());
  listen(window, "doke-silicon-state", (event) =>
    drawStimulus(event.detail?.input),
  );
  listen(document, "visibilitychange", () => {
    if (document.hidden) pause();
    lastFrame = null;
  });
  listen(reducedQuery, "change", (event) => {
    reduced = event.matches;
    updateLight();
    if (reduced) pause();
    dirty = true;
  });
  listen($("#light-mode"), "change", resize);
  listen($("#resolution"), "change", resize);
  listen($("#brain-quality"), "change", (event) => {
    void setQuality(event.target.value);
  });
  listen($("#reduce-motion"), "change", (event) => {
    reduced = event.target.checked;
    if (reduced) pause();
    updateLight();
  });
  listen(window, "resize", resize);
  drawStimulus(window.dokeSilicon?.input?.() || input);
  if ($("#brain-quality")) $("#brain-quality").disabled = true;
  loadingStatus("Opening the atlas…");
  update();
  try {
    const get = async (url, json) => {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok)
        throw new Error(`${url} unavailable (${response.status})`);
      return json
        ? response.json()
        : new Uint8Array(await response.arrayBuffer());
    };
    const [guideResult, atlasResult, meshResult] = await Promise.allSettled([
      get("comparison.json", true),
      get("assets/atlas.json", true),
      get("assets/brain.bin", false),
    ]);
    if (disposed) return controller;
    if (guideResult.status === "rejected") throw guideResult.reason;
    const data = guideResult.value;
    const guide = data?.brain;
    if (
      !guide ||
      guide.durationSeconds !== 16 ||
      !Array.isArray(guide.stages) ||
      guide.stages.length !== 4 ||
      !data.sources ||
      guide.stages.some(
        (stage, i) =>
          stage.startSeconds !== i * 4 ||
          stage.endSeconds !== (i + 1) * 4 ||
          typeof stage.title !== "string" ||
          typeof stage.text !== "string" ||
          !Array.isArray(stage.regions) ||
          !Array.isArray(stage.sources) ||
          stage.sources.some((id) => !data.sources[id]),
      )
    ) {
      throw new Error("Comparison guide is invalid");
    }
    // Preserve valid explanations and source access even when the mesh fails.
    comparison = data;
    if (atlasResult.status === "rejected") throw atlasResult.reason;
    atlas = atlasResult.value;
    if (
      !Array.isArray(atlas.regions) ||
      guide.stages.some((stage) =>
        stage.regions.some(
          (id) => !atlas.regions.some((region) => region.id === id),
        ),
      )
    ) {
      throw new Error("Comparison guide does not match the atlas");
    }
    if (meshResult.status === "rejected") throw meshResult.reason;
    const mesh = meshResult.value;
    overviewMesh = mesh;
    resize();
    const forceGL =
      !navigator.gpu ||
      new URLSearchParams(location.search).get("backend") === "webgl";
    try {
      renderer = await wasm.BrainRenderer.create(canvas, forceGL, hdrCapable());
    } catch (cause) {
      if (forceGL || disposed) throw cause;
      const replacement = canvas.cloneNode();
      canvas.replaceWith(replacement);
      canvas = replacement;
      resize();
      renderer = await wasm.BrainRenderer.create(canvas, true, false);
    }
    if (disposed) {
      renderer.free?.();
      renderer = null;
      return controller;
    }
    renderer.load_mesh(mesh);
    activeMesh = mesh;
    renderer.anatomy();
    renderer.accents(true);
    initialView();
    resize();
    bindCanvas();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    ready = true;
    if ($("#brain-quality")) {
      $("#brain-quality").disabled = false;
      $("#brain-quality").value = quality;
    }
    loadingStatus("");
    qualityStatus(
      `Overview · ${renderer.triangle_count().toLocaleString()} triangles`,
    );
    canvas.dataset.ready = "true";
    canvas.dataset.backend = renderer.backend();
    lastStage = -1;
    update();
  } catch (cause) {
    if (disposed) return controller;
    error = `Reference atlas unavailable: ${cause?.message || cause}`;
    renderer?.free?.();
    renderer = null;
    canvas.dataset.ready = "false";
    canvas.dataset.error = error;
    loadingStatus(
      "The 3D atlas is unavailable. Reload to retry; the guide and evidence remain available.",
      true,
    );
    update();
    if (!comparison && controls.title)
      controls.title.textContent = "Reference anatomy";
    if (controls.copy)
      controls.copy.textContent = comparison
        ? `${currentStage().text} 3D is unavailable; the guide and evidence still work.`
        : `${error}. Reload to retry loading the guide.`;
    console.warn(error);
  }
  if (!disposed) frameId = requestAnimationFrame(frame);
  return controller;
}
