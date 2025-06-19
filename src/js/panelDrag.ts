import { getCookie, setCookie } from "./utils";

function restorePanelState(panel: HTMLElement) {
  const id = panel.id;

  const pos = getCookie(`panel-${id}-position`);
  const size = getCookie(`panel-${id}-size`);

  if (pos) {
    const [left, top] = pos.split(",");
    panel.style.position = "absolute";
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  if (size) {
    const [width, height] = size.split(",");
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  }
}

function makePanelDraggable(panel: HTMLElement) {
  const header = panel.querySelector(".panel-header") as HTMLElement;
  if (!header) return;
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (e) => {
    isDragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
    panel.style.zIndex = "9999";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      panel.style.position = "absolute";
      panel.style.left = `${e.clientX - offsetX}px`;
      panel.style.top = `${e.clientY - offsetY}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = "";

      const id = panel.id;
      const left = parseInt(panel.style.left || "0", 10);
      const top = parseInt(panel.style.top || "0", 10);
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;

      setCookie(`panel-${id}-position`, `${left},${top}`);
      setCookie(`panel-${id}-size`, `${width},${height}`);
    }
  });
}

export function reCenterAllWindows() {
  const panels = document.getElementsByClassName(
    "panel"
  ) as HTMLCollectionOf<HTMLElement>;

  for (const panel of panels) {
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;

    const centerX = (window.innerWidth - panelWidth) / 2;
    const centerY = (window.innerHeight - panelHeight) / 2;

    panel.style.position = "absolute";
    panel.style.left = `${centerX}px`;
    panel.style.top = `${centerY}px`;
  }
}
// Initialize
document.querySelectorAll<HTMLElement>(".panel").forEach((panel) => {
  restorePanelState(panel);
  makePanelDraggable(panel);
});
