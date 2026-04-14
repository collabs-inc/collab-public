const GAP = 8;
const IS_MAC = window.shellApi.getPlatform() === "darwin";

function platformShortcut(shortcut) {
  if (IS_MAC) return shortcut;
  return shortcut.replace("Cmd", "Ctrl").replace("Opt", "Alt");
}

let tooltipEl = null;
let activeTarget = null;

function show(target) {
  if (target === activeTarget) return;
  activeTarget = target;
  const label = target.dataset.tooltip;
  const shortcut = target.dataset.shortcut
    ? platformShortcut(target.dataset.shortcut)
    : null;
  if (!label) return;

  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "tooltip";
    document.body.appendChild(tooltipEl);
  }

  tooltipEl.innerHTML = `<span>${label}</span>`;
  if (shortcut) {
    tooltipEl.innerHTML += `<kbd>${shortcut}</kbd>`;
  }

  const rect = target.getBoundingClientRect();
  const vw = window.innerWidth;

  tooltipEl.classList.remove("visible");
  tooltipEl.style.left = "";
  tooltipEl.style.top = "";
  document.body.appendChild(tooltipEl);

  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;

  if (rect.left < vw * 0.25) {
    tooltipEl.style.left = `${rect.right + GAP}px`;
    tooltipEl.style.top = `${rect.top + (rect.height - th) / 2}px`;
  } else if (rect.right > vw * 0.75) {
    tooltipEl.style.left = `${rect.left - tw - GAP}px`;
    tooltipEl.style.top = `${rect.top + (rect.height - th) / 2}px`;
  } else {
    tooltipEl.style.left = `${rect.left + (rect.width - tw) / 2}px`;
    tooltipEl.style.top = `${rect.bottom + GAP}px`;
  }

  requestAnimationFrame(() => tooltipEl.classList.add("visible"));
}

function hide() {
  activeTarget = null;
  if (tooltipEl) tooltipEl.classList.remove("visible");
}

document.addEventListener("mouseenter", (e) => {
  const target = e.target.closest("[data-tooltip]");
  if (!target) return;
  show(target);
}, true);

document.addEventListener("mouseleave", (e) => {
  const leaving = e.target.closest("[data-tooltip]");
  if (!leaving) return;
  const entering = e.relatedTarget?.closest?.("[data-tooltip]");
  if (entering === leaving) return;
  hide();
}, true);

document.addEventListener("mousedown", () => hide(), true);
