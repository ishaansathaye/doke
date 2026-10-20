/** Shared direct-manipulation controls for the chip and reference atlas. */
function wheelUnit(event, viewportHeight) {
  return event.deltaMode === 1
    ? 16
    : event.deltaMode === 2
      ? viewportHeight
      : 1;
}
export function wheelZoom(event, viewportHeight) {
  // Ctrl+wheel is the browser's trackpad-pinch signal. Its deltas are smaller
  // than a mouse wheel's; ordinary scrolling still has a continuous response.
  const delta =
    event.deltaY *
    wheelUnit(event, viewportHeight) *
    (event.ctrlKey ? 0.008 : 0.0015);
  return Number.isFinite(delta) ? Math.max(-0.45, Math.min(0.45, delta)) : 0;
}

export function bindCameraControls(
  canvas,
  {
    getRenderer,
    onChange = () => {},
    onInteract = () => {},
    onTap = () => {},
    onHover = () => {},
    onLeave = () => {},
    onReset = () => {},
    onInspect = () => {},
    signal,
  },
) {
  const abort = new AbortController();
  const points = new Map();
  let pinch = null;
  let gestureScale = null;
  let cursor = null;
  const listen = (type, handler, options = {}) =>
    canvas.addEventListener(type, handler, {
      ...options,
      signal: abort.signal,
    });
  const height = () => Math.max(1, canvas.getBoundingClientRect().height);
  const changed = () => {
    onInteract();
    onChange();
  };
  const pan = (dx, dy) => getRenderer()?.pan_pixels(dx, dy, height());
  const zoom = (delta, x, y) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = cursor?.x ?? rect.left + rect.width / 2;
      y = cursor?.y ?? rect.top + rect.height / 2;
    }
    getRenderer()?.zoom_at(
      delta,
      (x - rect.left) / rect.width,
      (y - rect.top) / rect.height,
    );
  };
  const pair = () => {
    if (points.size < 2) return null;
    const [a, b] = [...points.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  };
  function clear() {
    const captured = [...points.keys()];
    points.clear();
    pinch = null;
    gestureScale = null;
    delete canvas.dataset.dragging;
    delete canvas.dataset.cameraInput;
    for (const id of captured)
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  const dispose = () => {
    clear();
    abort.abort();
  };
  if (signal?.aborted) return dispose;
  signal?.addEventListener("abort", dispose, { once: true });
  canvas.style.touchAction = "none";

  listen("pointerdown", (event) => {
    if (event.pointerType === "mouse" && ![0, 1, 2].includes(event.button))
      return;
    event.preventDefault();
    canvas.dataset.cameraInput = "pointer";
    cursor = { x: event.clientX, y: event.clientY };
    canvas.focus({ preventScroll: true });
    onInteract();
    onLeave();
    points.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: points.size > 0 || event.button !== 0 || event.shiftKey,
      pan: event.button !== 0 || event.shiftKey,
    });
    if (points.size > 1)
      for (const point of points.values()) point.moved = true;
    pinch = pair();
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "true";
  });
  listen("pointermove", (event) => {
    cursor = { x: event.clientX, y: event.clientY };
    const point = points.get(event.pointerId);
    if (!point) {
      if (!points.size && event.pointerType !== "touch") onHover(event);
      return;
    }
    const dx = event.clientX - point.x,
      dy = event.clientY - point.y;
    point.x = event.clientX;
    point.y = event.clientY;
    point.moved ||=
      Math.hypot(point.x - point.startX, point.y - point.startY) > 4;
    if (points.size > 1) {
      const next = pair();
      if (pinch && next.distance > 1 && pinch.distance > 1) {
        zoom(Math.log(pinch.distance / next.distance), pinch.x, pinch.y);
        pan(next.x - pinch.x, next.y - pinch.y);
        changed();
      }
      pinch = next;
    } else if (point.moved) {
      if (point.pan || event.shiftKey) pan(dx, dy);
      else getRenderer()?.orbit(-dx * 0.005, dy * 0.005);
      changed();
    }
  });
  function release(event, select = false) {
    const point = points.get(event.pointerId);
    const tap = select && point && !point.moved && points.size === 1;
    points.delete(event.pointerId);
    pinch = pair();
    if (!points.size) delete canvas.dataset.dragging;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (tap) onTap(event);
  }
  listen("pointerup", (event) => release(event, true));
  listen("pointercancel", (event) => release(event));
  listen("lostpointercapture", (event) => release(event));
  listen("pointerleave", onLeave);
  listen("blur", clear);
  listen("contextmenu", (event) => event.preventDefault());
  listen(
    "wheel",
    (event) => {
      event.preventDefault();
      if (gestureScale !== null) return;
      if (
        !event.ctrlKey &&
        (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
      ) {
        const unit = wheelUnit(event, height());
        pan(-event.deltaX * unit, -event.deltaY * unit);
      } else zoom(wheelZoom(event, height()), event.clientX, event.clientY);
      changed();
    },
    { passive: false },
  );
  // Safari's desktop trackpad exposes pinch through GestureEvent.
  listen(
    "gesturestart",
    (event) => {
      event.preventDefault();
      gestureScale = event.scale || 1;
      onInteract();
    },
    { passive: false },
  );
  listen(
    "gesturechange",
    (event) => {
      event.preventDefault();
      if (gestureScale > 0 && event.scale > 0) {
        zoom(
          Math.log(gestureScale / event.scale),
          event.clientX,
          event.clientY,
        );
        changed();
      }
      gestureScale = event.scale;
    },
    { passive: false },
  );
  listen(
    "gestureend",
    (event) => {
      event.preventDefault();
      gestureScale = null;
    },
    { passive: false },
  );
  listen("keydown", (event) => {
    const move = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (move) {
      if (event.shiftKey) pan(move[0] * 24, move[1] * 24);
      else getRenderer()?.orbit(-move[0] * 0.1, move[1] * 0.1);
    } else if (event.key === "+" || event.key === "=")
      getRenderer()?.zoom(-0.15);
    else if (event.key === "-" || event.key === "_") getRenderer()?.zoom(0.15);
    else if (event.key === "Home") onReset();
    else if (event.key === "Enter") onInspect();
    else return;
    event.preventDefault();
    delete canvas.dataset.cameraInput;
    changed();
  });
  return dispose;
}
