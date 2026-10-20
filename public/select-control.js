/** Floating, keyboard-accessible pickers backed by the app's native selects. */
export function initSelectControls(root = document) {
  const controls = new Map();
  let opened = null,
    serial = 0,
    search = "",
    searchTime = 0;
  const popup = document.createElement("div");
  popup.className = "select-menu";
  popup.id = "doke-select-menu";
  popup.setAttribute("role", "listbox");
  popup.hidden = true;
  document.body.append(popup);

  const options = (select) =>
    [...select.options].filter(
      (option) => !option.hidden && !option.parentElement.hidden,
    );
  const enabled = (option) =>
    !option.disabled && !option.closest("optgroup")?.disabled;
  const nameOf = (select) => {
    if (select.getAttribute("aria-label"))
      return select.getAttribute("aria-label");
    const labelled = select.getAttribute("aria-labelledby");
    if (labelled)
      return labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim();
    return (
      [...select.labels]
        .map((label) => {
          const copy = label.cloneNode(true);
          copy
            .querySelectorAll("select, button")
            .forEach((node) => node.remove());
          return copy.textContent.trim();
        })
        .join(" ") || "Choose an option"
    );
  };

  function close() {
    if (!opened) return;
    opened.button.setAttribute("aria-expanded", "false");
    opened.button.removeAttribute("aria-activedescendant");
    opened.wrapper.classList.remove("is-open");
    popup.hidden = true;
    popup.replaceChildren();
    opened = null;
    search = "";
  }
  function place() {
    if (!opened) return;
    const rect = opened.button.getBoundingClientRect(),
      viewport = window.visualViewport,
      left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0,
      width = viewport?.width || innerWidth,
      height = viewport?.height || innerHeight,
      edge = 12,
      gap = 8,
      below = top + height - edge - rect.bottom - gap,
      above = rect.top - top - edge - gap,
      upwards = below < Math.min(popup.scrollHeight, 210) && above > below;
    popup.style.width = `${Math.min(Math.max(rect.width, 250), width - edge * 2)}px`;
    popup.style.maxHeight = `${Math.max(0, Math.min(420, upwards ? above : below))}px`;
    popup.style.left = `${Math.max(left + edge, Math.min(rect.left, left + width - popup.offsetWidth - edge))}px`;
    popup.style.top = `${upwards ? rect.top - gap - popup.offsetHeight : rect.bottom + gap}px`;
    popup.dataset.side = upwards ? "above" : "below";
  }
  function highlight(index, scroll = true) {
    if (!opened || !opened.items[index] || !enabled(opened.items[index]))
      return;
    opened.active = index;
    popup.querySelectorAll('[role="option"]').forEach((node, i) => {
      node.classList.toggle("is-active", i === index);
      if (i === index) {
        opened.button.setAttribute("aria-activedescendant", node.id);
        if (scroll) node.scrollIntoView({ block: "nearest" });
      }
    });
  }
  function drawOptions() {
    const control = opened;
    if (!control) return;
    control.items = options(control.select);
    popup.replaceChildren();
    let previousGroup = null,
      container = popup;
    control.items.forEach((option, index) => {
      const group = option.closest("optgroup");
      if (group !== previousGroup) {
        container = popup;
        if (group) {
          container = document.createElement("div");
          container.className = "select-group";
          container.setAttribute("role", "group");
          container.setAttribute("aria-label", group.label);
          const heading = document.createElement("div");
          heading.className = "select-group-label";
          heading.textContent = group.label;
          heading.setAttribute("aria-hidden", "true");
          container.append(heading);
          popup.append(container);
        }
        previousGroup = group;
      }
      const row = document.createElement("div");
      row.className = "select-option";
      row.id = `${control.id}-option-${index}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option.selected));
      row.setAttribute("aria-disabled", String(!enabled(option)));
      row.dataset.index = index;
      const text = document.createElement("span");
      text.textContent = option.label;
      const mark = document.createElement("span");
      mark.className = "select-check";
      mark.textContent = "✓";
      mark.setAttribute("aria-hidden", "true");
      row.append(text, mark);
      container.append(row);
    });
    const current = control.items.findIndex((option) => option.selected);
    control.active =
      current >= 0 && enabled(control.items[current])
        ? current
        : control.items.findIndex(enabled);
    place();
    highlight(control.active);
  }
  function open(control) {
    if (control.select.disabled) return;
    if (opened === control) return close();
    close();
    opened = control;
    control.button.setAttribute("aria-expanded", "true");
    control.wrapper.classList.add("is-open");
    popup.setAttribute("aria-label", control.name);
    popup.hidden = false;
    searchTime = 0;
    drawOptions();
  }
  function choose(index) {
    const control = opened,
      option = control?.items[index];
    if (!option || !enabled(option)) return;
    const changed = control.select.value !== option.value;
    control.select.value = option.value;
    close();
    control.button.focus({ preventScroll: true });
    if (changed) {
      control.select.dispatchEvent(new Event("input", { bubbles: true }));
      control.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // A model change can replace an inspector's markup synchronously.
    queueMicrotask(() => {
      if (!control.button.isConnected && control.select.id)
        controls
          .get(document.getElementById(control.select.id))
          ?.button.focus({ preventScroll: true });
    });
  }
  function keydown(event, control) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const isOpen = opened === control;
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (["Enter", " "].includes(event.key) && !(search && event.key === " ")) {
      event.preventDefault();
      event.stopPropagation();
      if (isOpen) choose(control.active);
      else open(control);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!isOpen) open(control);
      const indexes = control.items.flatMap((option, index) =>
        enabled(option) ? [index] : [],
      );
      const position = indexes.indexOf(control.active),
        next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? indexes.length - 1
              : Math.max(
                  0,
                  Math.min(
                    indexes.length - 1,
                    position + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
      highlight(indexes[next]);
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      event.stopPropagation();
      if (!isOpen) open(control);
      const now = performance.now();
      search = now - searchTime > 650 ? event.key : search + event.key;
      searchTime = now;
      const query = search.toLocaleLowerCase();
      const index = control.items.findIndex(
        (option) =>
          enabled(option) && option.label.toLocaleLowerCase().startsWith(query),
      );
      if (index >= 0) highlight(index);
    }
  }
  function enhance(select) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    const wrapper = document.createElement("span"),
      button = document.createElement("button"),
      text = document.createElement("span"),
      arrow = document.createElement("span"),
      control = {
        select,
        wrapper,
        button,
        text,
        name: nameOf(select),
        id: `doke-select-${++serial}`,
        items: [],
        active: -1,
      };
    controls.set(select, control);
    wrapper.className = "select-control";
    wrapper.dataset.select = select.id;
    button.className = "select-trigger";
    button.type = "button";
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-label", control.name);
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", popup.id);
    text.className = "select-value";
    arrow.className = "select-chevron";
    arrow.setAttribute("aria-hidden", "true");
    button.append(text, arrow);
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add("select-native");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    const sync = () => {
      text.textContent = select.selectedOptions[0]?.label || "Choose…";
      button.disabled = select.disabled;
      button.title = text.textContent;
      if (opened === control) {
        if (select.disabled) close();
        else drawOptions();
      }
    };
    // The app changes .value directly when profiles and atlas quality change.
    // Keep the native element authoritative, without polling on every frame.
    for (const property of ["value", "selectedIndex"]) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        property,
      );
      Object.defineProperty(select, property, {
        configurable: true,
        get: () => descriptor.get.call(select),
        set: (value) => {
          descriptor.set.call(select, value);
          sync();
        },
      });
    }
    select.addEventListener("change", sync);
    select.addEventListener("input", sync);
    select.addEventListener("focus", () =>
      button.focus({ preventScroll: true }),
    );
    button.addEventListener("click", () => open(control));
    button.addEventListener("keydown", (event) => keydown(event, control));
    control.observer = new MutationObserver(sync);
    control.observer.observe(select, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "label", "selected", "hidden", "value"],
    });
    sync();
  }
  function scan(node) {
    if (node.nodeType !== Node.ELEMENT_NODE && node !== document) return;
    if (node.matches?.("select")) enhance(node);
    node.querySelectorAll("select").forEach(enhance);
  }
  popup.addEventListener("pointerdown", (event) => {
    // Keep keyboard focus on the combobox while clicking a listbox option.
    if (event.target.closest('[role="option"]')) event.preventDefault();
  });
  popup.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) choose(Number(option.dataset.index));
  });
  popup.addEventListener("pointermove", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) highlight(Number(option.dataset.index), false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      opened &&
      !opened.wrapper.contains(event.target) &&
      !popup.contains(event.target)
    )
      close();
  });
  document.addEventListener("focusin", (event) => {
    if (opened && !opened.wrapper.contains(event.target)) close();
  });
  document.addEventListener(
    "scroll",
    (event) => {
      if (opened && !popup.contains(event.target)) place();
    },
    true,
  );
  window.addEventListener("resize", place);
  window.visualViewport?.addEventListener("resize", place);
  scan(root);
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) scan(node);
    for (const [select, control] of controls)
      if (!select.isConnected) {
        if (opened === control) close();
        control.observer.disconnect();
        controls.delete(select);
      }
    if (opened && !opened.select.getClientRects().length) close();
  }).observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
}
