/** The axis compares durations only; bandwidth and throughput never become clocks. */
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new RangeError("Duration must be positive and finite");
  const [scale, unit] =
    seconds < 1e-6
      ? [1e9, "ns"]
      : seconds < 1e-3
        ? [1e6, "µs"]
        : seconds < 1
          ? [1e3, "ms"]
          : [1, "s"];
  return `${Number((seconds * scale).toPrecision(3))} ${unit}`;
}
export function clockPeriod(timing) {
  return timing?.kind === "clock" && Number.isFinite(timing.hz) && timing.hz > 0
    ? 1 / timing.hz
    : null;
}
export function durationPosition(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new RangeError("Invalid duration");
  return Math.max(0, Math.min(100, (Math.log10(seconds) + 10) * 10));
}
export function timingPanel(data, profile, sourceButtons) {
  const period = clockPeriod(profile.timing),
    clock = profile.timing;
  function rail(min, max) {
    const left = durationPosition(min),
      width = durationPosition(max) - left;
    return `<div class="duration-rail" aria-hidden="true"><i class="${width ? "duration-range" : "duration-point"}" style="left:${left}%;${width ? `width:${width}%` : ""}"></i></div>`;
  }
  const reference = period
    ? `<div class="duration-reference" data-clock-seconds="${period}"><span class="eyebrow">${esc(profile.name)} · CLOCK PERIOD</span><strong>${formatDuration(period)}</strong>${rail(period, period)}</div>`
    : clock
      ? `<div class="rate-reference"><span class="eyebrow">${esc(profile.name)}</span><strong>${esc(clock.label)}</strong><p>This is a rate, so it is not placed on the duration axis.</p></div>`
      : "";
  return `<span class="eyebrow">SILICON & HUMAN MEASUREMENTS</span><h2>${esc(data.title)}</h2><p>${esc(data.intro)}</p><div class="duration-axis" aria-label="Logarithmic duration axis from 0.1 nanoseconds to 1 second"><span style="left:10%">1 ns</span><span style="left:40%">1 µs</span><span style="left:70%">1 ms</span><span style="left:100%">1 s</span></div>${reference}${data.measurements.map((m) => `<details class="duration-event" data-measurement="${esc(m.id)}" data-min-seconds="${m.minSeconds}" data-max-seconds="${m.maxSeconds}"><summary><span>${esc(m.label)}</span><strong>${esc(m.displayValue)}</strong>${rail(m.minSeconds, m.maxSeconds)}</summary><p>${esc(m.context)}</p><p>${esc(m.interpretation)}</p>${sourceButtons(m.sourceIds, "timescales")}</details>`).join("")}${clock ? `<details><summary>Hardware reference & conditions</summary><p>${esc(clock.label)}. ${esc(clock.scope)}</p>${sourceButtons(clock.sourceIds)}</details>` : ""}<p class="limit">${esc(data.comparisonLimit)}</p><h3>Comparing the parts</h3>${data.parts.map((p) => `<details><summary>${esc(p.label)}</summary><p><b>Silicon.</b> ${esc(p.silicon)}</p><p><b>Brain.</b> ${esc(p.brain)}</p><p class="limit">${esc(p.limit)}</p>${sourceButtons(p.sourceIds, "timescales")}</details>`).join("")}<details><summary>How the clock period is calculated</summary><p>${esc(data.clockRule)}</p></details>`;
}
