// Reserve space for actual text and controls, including wrapped titles and docks.
// Scene canvases observe their own size; moving a panel never resets a camera.
export function installPanelLayout(onLayout = () => {}) {
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const header = $("header");
  const heading = $(".scene-heading");
  const brainHeading = $("#brain-label");
  const dock = $("#dock");
  const guide = $("#brain-guide");
  const visible = (el) => el.checkVisibility();
  let scheduled = false;
  function update() {
    scheduled = false;
    const compact = matchMedia(
      "(max-width: 1000px), (max-height: 650px)",
    ).matches;
    const comparing = document.body.classList.contains("compare-mode");
    const short = innerHeight <= 650;
    const px = (name, value) =>
      root.style.setProperty(name, `${Math.round(value)}px`);
    const headerBottom = header.getBoundingClientRect().bottom;
    px("--switch-top", headerBottom + 12);
    const sceneTop =
      headerBottom + (comparing && compact ? 58 : short ? 16 : 28);
    px("--scene-top", sceneTop);
    const controlsBottom = visible(dock)
      ? innerHeight - dock.getBoundingClientRect().top + 14
      : 36;
    px("--controls-bottom", controlsBottom);
    px("--panel-bottom", controlsBottom + 56);
    const activeHeading =
      comparing && compact && document.body.dataset.comparisonView === "brain"
        ? brainHeading
        : heading;
    const headingBottom = activeHeading.getBoundingClientRect().bottom;
    px("--panel-top", short ? sceneTop : headingBottom + 16);
    px("--chip-top", heading.getBoundingClientRect().bottom + 12);
    px("--brain-top", brainHeading.getBoundingClientRect().bottom + 12);
    px(
      "--brain-bottom",
      visible(guide)
        ? innerHeight - guide.getBoundingClientRect().top + 16
        : controlsBottom + 56,
    );
    onLayout();
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  }
  const sizes = new ResizeObserver(schedule);
  [header, heading, brainHeading, dock, guide].forEach((el) =>
    sizes.observe(el),
  );
  const state = new MutationObserver(schedule);
  state.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-world", "data-comparison-view"],
  });
  for (const el of [$("#reader"), $("#settings"), brainHeading, dock, guide])
    state.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", schedule);
  document.fonts.ready.then(schedule);
  update();
}
